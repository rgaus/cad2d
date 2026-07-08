import EventEmitter from 'eventemitter3';

/** A test helper to listen to events received by an event emitter and allow them to be imperatively
 * queried after the fact. */
export function subscribeToEvents<
  Callbacks extends { [key: string]: (...args: any) => any },
  Emitter extends EventEmitter<Callbacks>,
>(eventEmitter: Emitter, eventNames: ReturnType<Emitter['eventNames']>) {
  // Wrap buffered events in a `{ event }` envelope so that no-payload events (like
  // `reset: () => void`) survive the `if (earliestBufferedEvent)` check in waitFor --
  // an `undefined` payload would otherwise look the same as an empty buffer.
  const nextEventListeners = new Map<keyof Callbacks, Array<(e: { event: unknown }) => void>>(
    eventNames.map((eventName) => [eventName, []]),
  );
  const buffers = new Map<keyof Callbacks, Array<{ event: unknown }>>(
    eventNames.map((eventName) => [eventName, []]),
  );

  const eventHandlers = eventNames.map((eventName) => {
    const onEvent = ((event: unknown) => {
      const listeners = nextEventListeners.get(eventName)!;
      if (listeners.length > 0) {
        for (const resolve of listeners) {
          resolve({ event });
        }
        nextEventListeners.set(eventName, []);
      } else {
        buffers.get(eventName)!.push({ event });
      }
    }) as Callbacks[keyof Callbacks];
    return [eventName, onEvent] as [keyof Callbacks, Callbacks[keyof Callbacks]];
  });
  for (const [eventName, onEvent] of eventHandlers) {
    eventEmitter.on(eventName as any, onEvent as any);
  }

  return {
    /** Listen for the next occurrance of an event to be emitted, or return the last event that was
     * buffered (but hasn't been processed yet). */
    async waitFor<EventPayload>(
      eventName: ReturnType<Emitter['eventNames']>[0],
    ): Promise<EventPayload> {
      // If an event is already buffered which hasn't been processed yet, pull that off the buffer
      // and use it.
      const buffer = buffers.get(eventName);
      if (!buffer) {
        throw new Error(`No events were buffered / received for event "${eventName.toString()}".`);
      }
      const earliestBufferedEvent = buffer.shift();
      if (earliestBufferedEvent) {
        return earliestBufferedEvent.event as EventPayload;
      }

      // Otherwise wait for the next event to come in.
      const promise = new Promise<{ event: unknown }>((resolve) => {
        nextEventListeners.get(eventName)!.push(resolve);
      });
      const { event } = await promise;
      return event as EventPayload;
    },
    /** Are there events of the given name which are waiting to be processed? Use this to assert
     * that no unexpected events have been emitted. */
    areThereBufferedEvents<EventName extends ReturnType<Emitter['eventNames']>[0]>(
      eventName: EventName,
    ) {
      const buffer = buffers.get(eventName);
      if (buffer) {
        return buffer.length > 0;
      } else {
        return false;
      }
    },
    /** Reset an given event's buffer to clear out any previously emitted events. */
    clearBufferedEvents<EventName extends ReturnType<Emitter['eventNames']>[0]>(
      eventName?: EventName,
    ): void {
      if (typeof eventName === 'undefined') {
        for (const eventName of eventNames) {
          buffers.set(eventName, []);
        }
      } else {
        buffers.set(eventName, []);
      }
    },
    /** Cleanup any lingering subscriptions. */
    unsubscribe: () => {
      for (const [eventName, onEvent] of eventHandlers) {
        eventEmitter.off(eventName as any, onEvent as any);
      }
    },
  };
}
