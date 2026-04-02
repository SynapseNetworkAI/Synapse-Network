export class SynapseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SynapseError";
  }
}

export class AuthenticationError extends SynapseError {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class InsufficientFundsError extends SynapseError {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientFundsError";
  }
}

export class QuoteError extends SynapseError {
  constructor(message: string) {
    super(message);
    this.name = "QuoteError";
  }
}

export class InvokeError extends SynapseError {
  constructor(message: string) {
    super(message);
    this.name = "InvokeError";
  }
}

export class DiscoveryError extends SynapseError {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

export class TimeoutError extends SynapseError {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}
