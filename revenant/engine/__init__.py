"""
Revenant Plugin Engine — Self-correcting AI agent framework.

Phases:
  Phase 1: Core plugin system (validation, discovery, loading)
  Phase 2: Advanced features (metrics, hooks, configuration)
  Phase 3: Lifecycle management (promotion, rollback, history)
"""

__version__ = "0.3.0"
__all__ = [
    "PluginValidator",
    "LifecycleManager",
    "PluginEngine",
    "ScaffoldGenerator",
]

from .validator import PluginValidator
from .lifecycle_manager import LifecycleManager
from .core import PluginEngine
from .scaffold_generator import ScaffoldGenerator
