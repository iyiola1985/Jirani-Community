export function assertNever(value: never, label = "Unhandled value"): never {
  throw new Error(`${label}: ${String(value)}`);
}
