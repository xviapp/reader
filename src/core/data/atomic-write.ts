declare const atomicWriteContextBrand: unique symbol;

/** Opaque capability proving that domain and task writes share one atomic commit. */
export interface AtomicWriteContext {
  readonly [atomicWriteContextBrand]: true;
}

