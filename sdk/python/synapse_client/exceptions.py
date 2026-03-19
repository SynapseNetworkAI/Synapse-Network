class SynapseClientError(Exception):
    """Base exception for synapse client."""


class BudgetExceededError(SynapseClientError):
    """Raised when a credential budget, daily cap, or spend guard blocks execution."""

class DiscoveryError(SynapseClientError):
    """Raised when service discovery request fails."""


class QuoteError(SynapseClientError):
    """Raised when quote creation or quote validation fails."""

class InvokeError(SynapseClientError):
    """Raised when paid invoke request fails."""

class InsufficientFundsError(BudgetExceededError):
    """Raised when there is not enough balance or remaining budget to continue."""

class AuthenticationError(SynapseClientError):
    """Raised when API key is invalid."""
