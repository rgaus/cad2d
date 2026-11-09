/** A namespace object for an entity component, keyed by its component key. */
type ComponentNamespace = {
  key: string;
};

const componentRegistry = new Map<string, unknown>();

/**
 * Registers a component namespace under its `key`.
 *
 * The generic parameter lets callers assert that a component namespace also satisfies a shared
 * interface (for example `TransformableTemplate`). The check is compile-time and catches missing
 * or incompatible methods at the registration site.
 */
export function registerComponent<Interface extends object>(
  component: ComponentNamespace & Interface,
): void {
  componentRegistry.set(component.key, component);
}

/** Returns the registered component namespace for the given key, if any. */
export function getComponent<Interface extends object>(
  key: string,
): (ComponentNamespace & Interface) | null {
  return (componentRegistry.get(key) as (ComponentNamespace & Interface) | undefined) ?? null;
}

/** Returns whether a component namespace has been registered for the given key. */
export function hasRegisteredComponent(key: string): boolean {
  return componentRegistry.has(key);
}
