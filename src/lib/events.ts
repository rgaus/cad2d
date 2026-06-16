import { EventEmitter } from 'eventemitter3';

/** Forward events from one {@link EventEmitter} to another. */
export function forwardEvents<Events extends {}>(
  destination: EventEmitter<Events>,
  source: EventEmitter<Events>,
) {
  const original = source.emit;
  source.emit = (eventName: EventEmitter.EventNames<Events>, ...args: Array<any>) => {
    const result = original.call(source, eventName, ...(args as any));
    destination.emit(eventName, ...(args as any));
    return result;
  };

  return () => {
    source.emit = original;
  };
}
