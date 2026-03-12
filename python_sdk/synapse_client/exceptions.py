
class SynapseClientError(Exception):
    """Base exception for synapse client."""

class DiscoveryError(SynapseClientError):
    """Raised when service discovery request fails."""

class InvokeError(SynapseClientError):
    """Raised when paid invoke request fails."""

class InsufficientFundsError(SynapseClientError):
    """Raised when there is not enough balance/USDC."""

class AuthenticationError(SynapseClientError):
    """Raised when API key is invalid."""
