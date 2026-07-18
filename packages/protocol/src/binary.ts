export class ProtocolError extends Error {
  override readonly name = "ProtocolError";
}

export function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new ProtocolError(`${label} must be finite`);
}

export function assertUint(value: number, bits: 8 | 16 | 32, label: string): void {
  const maximum = bits === 32 ? 0xffff_ffff : 2 ** bits - 1;
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new ProtocolError(`${label} must be uint${bits}`);
  }
}

export class Writer {
  private bytes = new Uint8Array(64);
  private view = new DataView(this.bytes.buffer);
  private offset = 0;

  private reserve(count: number): void {
    if (this.offset + count <= this.bytes.length) return;
    let size = this.bytes.length;
    while (size < this.offset + count) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.bytes);
    this.bytes = grown;
    this.view = new DataView(grown.buffer);
  }

  u8(value: number, label = "u8"): void {
    assertUint(value, 8, label);
    this.reserve(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  i8(value: number, label = "i8"): void {
    if (!Number.isInteger(value) || value < -128 || value > 127) {
      throw new ProtocolError(`${label} must be int8`);
    }
    this.reserve(1);
    this.view.setInt8(this.offset, value);
    this.offset += 1;
  }

  u16(value: number, label = "u16"): void {
    assertUint(value, 16, label);
    this.reserve(2);
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  i16(value: number, label = "i16"): void {
    if (!Number.isInteger(value) || value < -32_768 || value > 32_767) {
      throw new ProtocolError(`${label} must be int16`);
    }
    this.reserve(2);
    this.view.setInt16(this.offset, value, true);
    this.offset += 2;
  }

  u32(value: number, label = "u32"): void {
    assertUint(value, 32, label);
    this.reserve(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  f32(value: number, label = "f32"): void {
    assertFinite(value, label);
    this.reserve(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
  }

  raw(value: Uint8Array): void {
    this.reserve(value.length);
    this.bytes.set(value, this.offset);
    this.offset += value.length;
  }

  ascii(value: string, maximum: number, label: string): void {
    if (value.length > maximum) throw new ProtocolError(`${label} is too long`);
    this.u8(value.length, `${label}.length`);
    const encoded = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code < 0x20 || code > 0x7e) {
        throw new ProtocolError(`${label} must contain printable ASCII`);
      }
      encoded[index] = code;
    }
    this.raw(encoded);
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.offset);
  }
}

export class Reader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private require(count: number): void {
    if (count < 0 || this.remaining < count) {
      throw new ProtocolError("truncated frame");
    }
  }

  u8(): number {
    this.require(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  i8(): number {
    this.require(1);
    const value = this.view.getInt8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(): number {
    this.require(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  i16(): number {
    this.require(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.require(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f32(label: string): number {
    this.require(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    assertFinite(value, label);
    return value;
  }

  raw(count: number): Uint8Array {
    this.require(count);
    const value = this.bytes.slice(this.offset, this.offset + count);
    this.offset += count;
    return value;
  }

  ascii(maximum: number, label: string): string {
    const count = this.u8();
    if (count > maximum) throw new ProtocolError(`${label} is too long`);
    const value = this.raw(count);
    let decoded = "";
    for (const code of value) {
      if (code < 0x20 || code > 0x7e) {
        throw new ProtocolError(`${label} must contain printable ASCII`);
      }
      decoded += String.fromCharCode(code);
    }
    return decoded;
  }

  done(): void {
    if (this.remaining !== 0) throw new ProtocolError("frame has trailing bytes");
  }
}
