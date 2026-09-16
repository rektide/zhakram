import type { EventSink } from './sink.ts';

export type ValueSummary =
	| null
	| boolean
	| number
	| string
	| { type: 'undefined' }
	| { type: 'bigint'; value: string }
	| { type: 'number'; value: string }
	| { type: 'string'; length: number; preview: string }
	| { type: 'bytes'; class: string; length: number; preview: number[] }
	| { type: 'array'; length: number; items: ValueSummary[] }
	| { type: 'circular' }
	| { type: 'resource'; class: string; id: number }
	| { type: 'error'; class: string; message: string }
	| { type: 'function'; name: string }
	| { type: 'symbol'; description: string }
	| { type: 'object'; class: string; keys: string[] };

export interface ResourceCall {
	/** Stable within one observe() session. Absent for flat canonical imports. */
	id?: number;
	type: string;
	lifecycle: 'method' | 'drop';
}

interface CallEventBase {
	callId: number;
	interface: string;
	function: string;
	arguments: ValueSummary[];
	resource?: ResourceCall;
}

export interface CallStartEvent extends CallEventBase {
	type: 'call-start';
}

export interface CallEndEvent extends CallEventBase {
	type: 'call-end';
	result: ValueSummary;
	durationUs: number;
}

export interface CallErrorEvent extends CallEventBase {
	type: 'call-error';
	error: ValueSummary;
	durationUs: number;
}

export interface ResourceAcquireEvent {
	type: 'resource-acquire';
	interface: string;
	function: string;
	resource: Omit<ResourceCall, 'lifecycle'>;
}

export interface ResourceDropEvent {
	type: 'resource-drop';
	interface: string;
	function: string;
	resource: Omit<ResourceCall, 'lifecycle'>;
	durationUs: number;
}

export type ObservationEvent =
	| CallStartEvent
	| CallEndEvent
	| CallErrorEvent
	| ResourceAcquireEvent
	| ResourceDropEvent;

export interface InterfaceSummary {
	interface: string;
	calls: number;
	inFlight: number;
	resourceCalls: number;
	dropEvents: number;
}

export interface ObservationSummary {
	totals: Omit<InterfaceSummary, 'interface'>;
	interfaces: InterfaceSummary[];
}

export interface ObserveOptions {
	sink?: EventSink<ObservationEvent>;
	/** Millisecond clock, injectable for deterministic tests. */
	clock?: () => number;
}

interface MutableSummary {
	calls: number;
	inFlight: number;
	resourceCalls: number;
	dropEvents: number;
}

interface ResourceType {
	interface: string;
	type: string;
}

interface ResourceMeta extends ResourceType {
	id: number;
}

interface CallContext {
	interface: string;
	function: string;
	resource?: ResourceCall;
}

interface Controller {
	snapshot(): ObservationSummary;
}

type Imports = Record<PropertyKey, unknown>;

const controllers = new WeakMap<object, Controller>();

const NOOP_SINK: EventSink<ObservationEvent> = { emit() {} };

function defaultClock(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function kebab(name: string): string {
	return name
		.replace(/\$\d+$/, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/_/g, '-')
		.toLowerCase();
}

function isResourceConstructor(value: unknown): boolean {
	if (typeof value !== 'function' || !value.prototype) return false;
	return /^class\s/.test(Function.prototype.toString.call(value))
		|| Object.getOwnPropertyNames(value.prototype).some((name) => name !== 'constructor');
}

function isTypedArray(value: unknown): value is ArrayBufferView {
	return ArrayBuffer.isView(value);
}

function isRecordLike(value: unknown): value is object {
	if (value === null || typeof value !== 'object') return false;
	if (isTypedArray(value) || value instanceof ArrayBuffer || value instanceof Date
		|| value instanceof Map || value instanceof Set || value instanceof Promise) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null || Array.isArray(value);
}

/** JSON-safe, bounded rendering for values outside an observation session. */
export function summarize(value: unknown): ValueSummary {
	return summarizeValue(value);
}

function summarizeValue(
	value: unknown,
	resourceMeta?: WeakMap<object, ResourceMeta>,
	seen = new WeakSet<object>(),
	depth = 0,
): ValueSummary {
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'undefined') return { type: 'undefined' };
	if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() };
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : { type: 'number', value: String(value) };
	}
	if (typeof value === 'string') {
		return value.length <= 160
			? value
			: { type: 'string', length: value.length, preview: `${value.slice(0, 157)}…` };
	}
	if (typeof value === 'symbol') {
		return { type: 'symbol', description: value.description ?? '' };
	}
	if (typeof value === 'function') {
		return { type: 'function', name: value.name || '<anonymous>' };
	}

	const meta = resourceMeta?.get(value);
	if (meta) return { type: 'resource', class: meta.type, id: meta.id };
	if (value instanceof Error) {
		return { type: 'error', class: value.constructor.name, message: value.message };
	}
	if (isTypedArray(value)) {
		const bytes = new Uint8Array(value.buffer, value.byteOffset, Math.min(value.byteLength, 16));
		return {
			type: 'bytes',
			class: value.constructor.name,
			length: value.byteLength,
			preview: Array.from(bytes),
		};
	}
	if (value instanceof ArrayBuffer) {
		return {
			type: 'bytes',
			class: 'ArrayBuffer',
			length: value.byteLength,
			preview: Array.from(new Uint8Array(value, 0, Math.min(value.byteLength, 16))),
		};
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) return { type: 'circular' };
		seen.add(value);
		return {
			type: 'array',
			length: value.length,
			items: depth >= 3
				? []
				: value.slice(0, 12).map((item) => summarizeValue(item, resourceMeta, seen, depth + 1)),
		};
	}
	return {
		type: 'object',
		class: value.constructor?.name ?? 'Object',
		keys: Object.keys(value).slice(0, 16),
	};
}

function canonicalDirectFunction(name: PropertyKey): string {
	return typeof name === 'symbol' ? `[symbol]${name.description ?? ''}` : kebab(String(name));
}

function directResourceCall(name: string): ResourceCall | undefined {
	if (name.startsWith('[method]')) {
		return { type: name.slice(8).split('.')[0], lifecycle: 'method' };
	}
	if (name.startsWith('[resource-drop]')) {
		return { type: name.slice(15), lifecycle: 'drop' };
	}
	return undefined;
}

function resourceMethodName(resource: ResourceMeta, property: PropertyKey): CallContext {
	const drop = property === Symbol.dispose || property === 'dispose' || property === 'drop';
	return {
		interface: resource.interface,
		function: drop
			? `[resource-drop]${resource.type}`
			: `[method]${resource.type}.${canonicalDirectFunction(property)}`,
		resource: { id: resource.id, type: resource.type, lifecycle: drop ? 'drop' : 'method' },
	};
}

/**
 * Deeply wrap a component import object without mutating it.
 *
 * Direct host functions and methods on returned resource instances emit
 * call-start/call-end (or call-error) events. Resource constructors remain
 * untouched, so jco's generated `value instanceof ResourceClass` checks keep
 * working; only ordinary instances are proxied.
 */
export function observe<T extends Imports>(imports: T, opts: ObserveOptions = {}): T {
	if (controllers.has(imports)) return imports;

	const sink = opts.sink ?? NOOP_SINK;
	const clock = opts.clock ?? defaultClock;
	const interfaceSummaries = new Map<string, MutableSummary>();
	const resourceTypes = new WeakMap<Function, ResourceType>();
	const resourceMeta = new WeakMap<object, ResourceMeta>();
	const resourceProxies = new WeakMap<object, object>();
	const facadeCache = new WeakMap<object, Map<string, object>>();
	const functionCache = new WeakMap<Function, Map<string, Function>>();
	let nextCallId = 0;
	let nextResourceId = 0;

	const mutableSummary = (interfaceName: string): MutableSummary => {
		let summary = interfaceSummaries.get(interfaceName);
		if (!summary) {
			summary = { calls: 0, inFlight: 0, resourceCalls: 0, dropEvents: 0 };
			interfaceSummaries.set(interfaceName, summary);
		}
		return summary;
	};

	const indexConstructors = (value: unknown, interfaceName: string, depth = 0, seen = new WeakSet<object>()): void => {
		if (value === null || (typeof value !== 'object' && typeof value !== 'function') || depth > 3) return;
		if (typeof value === 'object') {
			if (seen.has(value)) return;
			seen.add(value);
		}
		for (const key of Reflect.ownKeys(value)) {
			let child: unknown;
			try {
				child = Reflect.get(value, key, value);
			} catch {
				continue;
			}
			if (isResourceConstructor(child)) {
				resourceTypes.set(child as Function, { interface: interfaceName, type: kebab(String(key)) });
			} else if (isRecordLike(child)) {
				indexConstructors(child, interfaceName, depth + 1, seen);
			}
		}
	};

	for (const key of Reflect.ownKeys(imports)) {
		if (typeof key === 'string') indexConstructors(Reflect.get(imports, key), key);
	}

	const complete = (
		context: CallContext,
		callId: number,
		args: ValueSummary[],
		start: number,
		result: unknown,
	): unknown => {
		const summary = mutableSummary(context.interface);
		summary.inFlight--;
		const durationUs = Math.max(0, Math.round((clock() - start) * 1000));
		sink.emit({
			type: 'call-end',
			callId,
			interface: context.interface,
			function: context.function,
			arguments: args,
			resource: context.resource,
			result: summarizeValue(result, resourceMeta),
			durationUs,
		});
		if (context.resource?.lifecycle === 'drop') {
			summary.dropEvents++;
			sink.emit({
				type: 'resource-drop',
				interface: context.interface,
				function: context.function,
				resource: { id: context.resource.id, type: context.resource.type },
				durationUs,
			});
		}
		return result;
	};

	const fail = (
		context: CallContext,
		callId: number,
		args: ValueSummary[],
		start: number,
		error: unknown,
	): never => {
		mutableSummary(context.interface).inFlight--;
		sink.emit({
			type: 'call-error',
			callId,
			interface: context.interface,
			function: context.function,
			arguments: args,
			resource: context.resource,
			error: summarizeValue(error, resourceMeta),
			durationUs: Math.max(0, Math.round((clock() - start) * 1000)),
		});
		throw error;
	};

	let wrapValue: (value: unknown, interfaceName: string, path: PropertyKey[]) => unknown;

	const callProxy = (fn: Function, context: CallContext, owner?: object): Function => {
		const key = `${context.interface}\u0000${context.function}\u0000${context.resource?.id ?? ''}`;
		let byContext = functionCache.get(fn);
		if (!byContext) {
			byContext = new Map();
			functionCache.set(fn, byContext);
		}
		const cached = byContext.get(key);
		if (cached) return cached;

		const proxy = new Proxy(fn, {
			apply(target, thisArg, rawArgs) {
				const args = rawArgs.map((arg) => summarizeValue(arg, resourceMeta));
				const callId = ++nextCallId;
				const start = clock();
				const summary = mutableSummary(context.interface);
				summary.calls++;
				summary.inFlight++;
				if (context.resource) summary.resourceCalls++;
				sink.emit({
					type: 'call-start',
					callId,
					interface: context.interface,
					function: context.function,
					arguments: args,
					resource: context.resource,
				});

				let result: unknown;
				try {
					result = Reflect.apply(target, owner ?? thisArg, rawArgs);
				} catch (error) {
					return fail(context, callId, args, start, error);
				}

				if (result instanceof Promise) {
					return result.then(
						(value) => complete(context, callId, args, start, wrapValue(value, context.interface, [])),
						(error) => fail(context, callId, args, start, error),
					);
				}
				return complete(context, callId, args, start, wrapValue(result, context.interface, []));
			},
		});
		byContext.set(key, proxy);
		return proxy;
	};

	const resourceProxy = (target: object, type: ResourceType, sourceFunction: string): object => {
		const cached = resourceProxies.get(target);
		if (cached) return cached;
		const meta: ResourceMeta = { ...type, id: ++nextResourceId };
		resourceMeta.set(target, meta);
		const methodCache = new Map<PropertyKey, Function>();
		const proxy = new Proxy(target, {
			get(resource, property) {
				const value = Reflect.get(resource, property, resource);
				if (typeof value !== 'function' || property === 'constructor') return value;
				const cachedMethod = methodCache.get(property);
				if (cachedMethod) return cachedMethod;
				const method = callProxy(value, resourceMethodName(meta, property), resource);
				methodCache.set(property, method);
				return method;
			},
		});
		resourceMeta.set(proxy, meta);
		resourceProxies.set(target, proxy);
		sink.emit({
			type: 'resource-acquire',
			interface: type.interface,
			function: sourceFunction,
			resource: { id: meta.id, type: meta.type },
		});
		return proxy;
	};

	const facade = (source: object, interfaceName: string, path: PropertyKey[]): object => {
		const cacheKey = `${interfaceName}\u0000${path.map(String).join('.')}`;
		let byPath = facadeCache.get(source);
		if (!byPath) {
			byPath = new Map();
			facadeCache.set(source, byPath);
		}
		const cached = byPath.get(cacheKey);
		if (cached) return cached;

		let proxy: object;
		proxy = new Proxy(Object.create(null), {
			get(_target, property) {
				return wrapValue(Reflect.get(source, property, source), interfaceName, [...path, property]);
			},
			set(_target, property, value) {
				return Reflect.set(source, property, value, source);
			},
			has(_target, property) {
				return Reflect.has(source, property);
			},
			ownKeys() {
				return Reflect.ownKeys(source);
			},
			getOwnPropertyDescriptor(_target, property) {
				if (!Reflect.has(source, property)) return undefined;
				return {
					configurable: true,
					enumerable: Reflect.getOwnPropertyDescriptor(source, property)?.enumerable ?? true,
					writable: true,
					value: wrapValue(Reflect.get(source, property, source), interfaceName, [...path, property]),
				};
			},
		});
		byPath.set(cacheKey, proxy);
		return proxy;
	};

	wrapValue = (value: unknown, interfaceName: string, path: PropertyKey[]): unknown => {
		if (typeof value === 'function') {
			if (isResourceConstructor(value)) return value;
			const functionName = path.length ? String(path[path.length - 1]) : value.name;
			const canonical = functionName.startsWith('[') ? functionName : canonicalDirectFunction(path.at(-1) ?? value.name);
			return callProxy(value, {
				interface: interfaceName,
				function: canonical,
				resource: directResourceCall(canonical),
			});
		}
		if (value === null || typeof value !== 'object') return value;

		const known = resourceMeta.get(value);
		if (known) return resourceProxies.get(value) ?? value;
		const type = resourceTypes.get(value.constructor);
		if (type) return resourceProxy(value, type, path.length ? canonicalDirectFunction(path.at(-1)!) : '<result>');
		if (isRecordLike(value)) return facade(value, interfaceName, path);
		return value;
	};

	const root = facade(imports, '', []);
	// The root facade needs each first-level key to become the interface name.
	const observed = new Proxy(root, {
		get(target, property) {
			if (typeof property === 'string' && Reflect.has(imports, property)) {
				return wrapValue(Reflect.get(imports, property, imports), property, []);
			}
			return Reflect.get(target, property);
		},
		getOwnPropertyDescriptor(_target, property) {
			if (!Reflect.has(imports, property)) return undefined;
			return {
				configurable: true,
				enumerable: Reflect.getOwnPropertyDescriptor(imports, property)?.enumerable ?? true,
				writable: true,
				value: typeof property === 'string'
					? wrapValue(Reflect.get(imports, property, imports), property, [])
					: Reflect.get(imports, property, imports),
			};
		},
	}) as T;

	controllers.set(observed, {
		snapshot() {
			const interfaces = [...interfaceSummaries.entries()]
				.map(([interfaceName, value]) => ({ interface: interfaceName, ...value }))
				.sort((a, b) => a.interface.localeCompare(b.interface));
			const totals = interfaces.reduce<Omit<InterfaceSummary, 'interface'>>(
				(acc, value) => ({
					calls: acc.calls + value.calls,
					inFlight: acc.inFlight + value.inFlight,
					resourceCalls: acc.resourceCalls + value.resourceCalls,
					dropEvents: acc.dropEvents + value.dropEvents,
				}),
				{ calls: 0, inFlight: 0, resourceCalls: 0, dropEvents: 0 },
			);
			return { totals, interfaces };
		},
	});
	return observed;
}

/** Return a mutation-safe counter snapshot for an object returned by observe(). */
export function observationSummary(observedImports: object): ObservationSummary {
	const controller = controllers.get(observedImports);
	if (!controller) throw new TypeError('observationSummary() needs the object returned by observe()');
	return controller.snapshot();
}

/** A compact, JSON-safe line suitable for Node and browser console sinks. */
export function formatObservationLine(event: ObservationEvent): string {
	if (event.type === 'resource-acquire') {
		return `host resource acquire ${event.interface}#${event.resource.type}:${event.resource.id}`;
	}
	if (event.type === 'resource-drop') {
		return `host resource drop ${event.interface}#${event.resource.type}:${event.resource.id ?? '?'} dur=${event.durationUs}µs`;
	}
	const resource = event.resource ? ` resource=${event.resource.type}:${event.resource.id ?? '?'}` : '';
	if (event.type === 'call-start') {
		return `host ${event.interface}#${event.function} start args=${JSON.stringify(event.arguments)}${resource}`;
	}
	if (event.type === 'call-error') {
		return `host ${event.interface}#${event.function} error=${JSON.stringify(event.error)} dur=${event.durationUs}µs${resource}`;
	}
	return `host ${event.interface}#${event.function} result=${JSON.stringify(event.result)} dur=${event.durationUs}µs${resource}`;
}

/** Default observation sink: print completed calls and resource lifecycle. */
export function consoleObservationSink(): EventSink<ObservationEvent> {
	return {
		emit(event) {
			if (event.type !== 'call-start') console.log(formatObservationLine(event));
		},
	};
}

export type { EventSink } from './sink.ts';
