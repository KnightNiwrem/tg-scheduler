export class UnimplementedError extends Error {
  constructor(operation: string) {
    super(`${operation} is not implemented`);
    this.name = 'UnimplementedError';
  }
}
