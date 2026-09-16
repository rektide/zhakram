/** A small structural sink shared by host observations and jcona-otel spans. */
export interface EventSink<Event> {
	emit(event: Event): void;
}
