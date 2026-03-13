"""seller_api package marker.

Keep this module side-effect free so submodules like `seller_api.persistence`
can be imported from runtime workers without requiring an app object here.
"""

__all__: list[str] = []
