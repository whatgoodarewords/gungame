export class FixedRing<T> {
  private readonly values: T[] = [];
  readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("ring capacity must be a positive integer");
    }
    this.capacity = capacity;
  }

  push(value: T): void {
    this.values.push(value);
    if (this.values.length > this.capacity) this.values.shift();
  }

  newest(): T | undefined {
    return this.values[this.values.length - 1];
  }

  toArray(): readonly T[] {
    return this.values.slice();
  }
}
