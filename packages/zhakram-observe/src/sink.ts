/** A small structural sink shared by host observations and zhakram-otel spans. */
export interface EventSink<Event> {
	emit(event: Event): void;
}
