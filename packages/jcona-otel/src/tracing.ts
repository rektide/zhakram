/**
 * JS host side for wasi:otel tracing guests (zena components via jco).
 *
 * jco's transpiled glue does all the canonical-ABI work: when the guest
 * calls `on-start` / `on-end`, the host functions below receive plain JS
 * values (already lifted); when the guest calls `current-span-context`, the
 * glue lowers our return value into guest memory through the guest's
 * `cabi_realloc`. So a host is just: a current-span stack + a sink.
 *
 * Wire it into an `-I async` transpiled component:
 *
 *     import { createTracing } from 'jcona-otel'; // or src/index.ts path
 *     const m = await import('./out/demo.js');
 *     const inst = await m.instantiate(undefined, {
 *       'wasi:otel/tracing': createTracing(), // + the shim's wasi namespaces
 *       ...
 *     });
 *
 * `createTracing()` defaults to a console sink (one line per closed span,
 * name + duration µs). The sink receives the full `SpanData` plus computed
 * `depth` / `durationUs`, which is everything an OTLP exporter needs — swap
 * sinks without touching guests.
 */

/** `wasi:otel/types.key-value`, as lifted by jco's transpiled glue. */
export interface KeyValue {
	key: string;
	value: string;
}

/** `wasi:clocks/wall-clock.datetime`, as lifted (u64 → bigint). */
export interface DateTime {
	seconds: bigint;
	nanoseconds: number;
}

/** `wasi:otel/tracing.span-context`, as lifted. */
export interface SpanContext {
	traceId: string;
	spanId: string;
	traceFlags: { sampled: boolean };
	isRemote: boolean;
	traceState: [string, string][];
}

/** `wasi:otel/tracing.status`. */
export type Status =
	| { tag: 'unset' }
	| { tag: 'ok' }
	| { tag: 'error'; val: string };

/** `wasi:otel/tracing.span-data`, as lifted by the transpiled glue. */
export interface SpanData {
	spanContext: SpanContext;
	parentSpanId: string;
	spanKind: 'client' | 'server' | 'producer' | 'consumer' | 'internal';
	name: string;
	startTime: DateTime;
	endTime: DateTime;
	attributes: KeyValue[];
	events: { name: string; time: DateTime; attributes: KeyValue[] }[];
	links: { spanContext: SpanContext; attributes: KeyValue[] }[];
	status: Status;
	instrumentationScope: {
		name: string;
		version?: string;
		schemaUrl?: string;
		attributes: KeyValue[];
	};
	droppedAttributes: number;
	droppedEvents: number;
	droppedLinks: number;
}

/** What a sink gets per closed span: the full span-data + host-computed shape. */
export interface EndedSpan {
	span: SpanData;
	/** Nesting depth at start time (root = 0). */
	depth: number;
	/** (end − start) in microseconds. */
	durationUs: bigint;
}

/** Pluggable span sink. The default logs one line per closed span. */
export interface SpanSink {
	onSpan(ended: EndedSpan): void;
}

function durationUs(start: DateTime, end: DateTime): bigint {
	const nanos =
		(end.seconds - start.seconds) * 1_000_000_000n +
		BigInt(end.nanoseconds - start.nanoseconds);
	return nanos / 1000n;
}

/** One flat line per closed span (the default sink's shape). */
export function formatSpanLine(ended: EndedSpan): string {
	const { span } = ended;
	const indent = '  '.repeat(ended.depth);
	const attrs = span.attributes.map((a) => `${a.key}=${a.value}`).join(' ');
	const status =
		span.status.tag === 'error' ? ` status=error(${span.status.val})`
		: span.status.tag === 'ok' ? ' status=ok'
		: '';
	const attrsSuffix = attrs ? ` ${attrs}` : '';
	return `${indent}span ${span.name} dur=${ended.durationUs}µs${status}${attrsSuffix}`;
}

/** Default sink: one console line per closed span, indented by depth. */
export function consoleSink(): SpanSink {
	return {
		onSpan(ended) {
			console.log(formatSpanLine(ended));
		},
	};
}

/** The `wasi:otel/tracing` host implementation object. */
export interface TracingHost {
	onStart(context: SpanContext): void;
	onEnd(span: SpanData): void;
	currentSpanContext(): SpanContext;
}

/** The zero sentinel guests treat as "no current span" (root span). */
const NO_CONTEXT: SpanContext = {
	traceId: '0'.repeat(32),
	spanId: '0'.repeat(16),
	traceFlags: { sampled: false },
	isRemote: false,
	traceState: [],
};

/**
 * Build the tracing host: span-context stack + sink.
 *
 * `on-start` pushes, `on-end` closes the matching span (matched by span-id,
 * searched from the top so properly nested spans are O(1)) and hands the
 * ended span to the sink. `current-span-context` returns the stack top, or
 * the all-zero sentinel when the guest is not inside any host-known span —
 * lib/zena/otel starts a root span (fresh trace-id, empty parent) then.
 */
export function createTracing(opts: { sink?: SpanSink } = {}): TracingHost {
	const sink = opts.sink ?? consoleSink();
	const stack: { ctx: SpanContext; depth: number }[] = [];

	return {
		onStart(context) {
			stack.push({ ctx: context, depth: stack.length });
		},

		onEnd(span) {
			let idx = stack.length - 1;
			while (idx >= 0 && stack[idx].ctx.spanId !== span.spanContext.spanId) idx--;
			const depth = idx >= 0 ? stack[idx].depth : 0;
			if (idx >= 0) stack.splice(idx, 1);
			sink.onSpan({
				span,
				depth,
				durationUs: durationUs(span.startTime, span.endTime),
			});
		},

		currentSpanContext() {
			return stack.length ? stack[stack.length - 1].ctx : NO_CONTEXT;
		},
	};
}
