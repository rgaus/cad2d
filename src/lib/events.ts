import { EventEmitter } from 'eventemitter3';

/** Forward events from one {@link EventEmitter} to another. */
export function forwardEvents<SourceEvents extends {}, DestinationEvents extends SourceEvents>(
  destination: EventEmitter<DestinationEvents>,
  source: EventEmitter<SourceEvents>,
) {
  const original = source.emit;
  source.emit = (eventName: EventEmitter.EventNames<SourceEvents>, ...args: Array<any>) => {
    const result = original.call(source, eventName, ...(args as any));
    destination.emit(eventName as any, ...(args as any));
    return result;
  };

  return () => {
    source.emit = original;
  };
}
