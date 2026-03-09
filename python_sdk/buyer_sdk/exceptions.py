class BuyerSDKError(Exception):
    """Base exception for buyer sdk."""


class DiscoveryError(BuyerSDKError):
    """Raised when service discovery request fails."""


class InvokeError(BuyerSDKError):
    """Raised when paid invoke request fails."""
