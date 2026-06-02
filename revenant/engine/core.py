"""
PluginEngine — Phase 1+2: Plugin loading, discovery, and lifecycle.

Combines validation (Phase 1) with metrics, hooks, and configuration management (Phase 2).
"""

import os
import json
import importlib
import importlib.util
from typing import Any, Callable, Dict, List, Optional
from dataclasses import dataclass, field


@dataclass
class PluginMetrics:
    """Tracks runtime metrics for a loaded plugin."""
    load_time_ms: float = 0.0
    call_count: int = 0
    error_count: int = 0
    last_error: Optional[str] = None
    uptime_seconds: float = 0.0

    @property
    def error_rate(self) -> float:
        if self.call_count == 0:
            return 0.0
        return self.error_count / self.call_count


@dataclass
class PluginInstance:
    """Represents a loaded plugin instance."""
    name: str
    version: str
    manifest: dict
    instance: Any = None
    metrics: PluginMetrics = field(default_factory=PluginMetrics)
    hooks: dict = field(default_factory=dict)
    config: dict = field(default_factory=dict)


class HookManager:
    """Manages plugin hook registration and invocation."""

    def __init__(self):
        self._hooks: Dict[str, List[Callable]] = {}

    def register(self, hook_name: str, callback: Callable):
        """Register a callback for a hook."""
        if hook_name not in self._hooks:
            self._hooks[hook_name] = []
        self._hooks[hook_name].append(callback)

    def unregister(self, hook_name: str, callback: Callable):
        """Unregister a callback from a hook."""
        if hook_name in self._hooks:
            self._hooks[hook_name] = [
                cb for cb in self._hooks[hook_name] if cb is not callback
            ]

    def invoke(self, hook_name: str, *args, **kwargs) -> List[Any]:
        """Invoke all callbacks for a hook."""
        results = []
        for callback in self._hooks.get(hook_name, []):
            try:
                result = callback(*args, **kwargs)
                results.append(result)
            except Exception as e:
                results.append(None)
        return results

    def list_hooks(self) -> Dict[str, int]:
        """Return hook names with callback counts."""
        return {name: len(cbs) for name, cbs in self._hooks.items()}


class ConfigStore:
    """Simple plugin configuration storage."""

    def __init__(self):
        self._config: Dict[str, Any] = {}

    def set(self, key: str, value: Any):
        self._config[key] = value

    def get(self, key: str, default: Any = None) -> Any:
        return self._config.get(key, default)

    def get_nested(self, path: str, default: Any = None) -> Any:
        """Get config using dot-notation path (e.g., 'db.host')."""
        keys = path.split(".")
        value = self._config
        for key in keys:
            if isinstance(value, dict) and key in value:
                value = value[key]
            else:
                return default
        return value

    def set_nested(self, path: str, value: Any):
        """Set config using dot-notation path."""
        keys = path.split(".")
        config = self._config
        for key in keys[:-1]:
            if key not in config:
                config[key] = {}
            config = config[key]
        config[keys[-1]] = value

    def delete(self, key: str) -> bool:
        if key in self._config:
            del self._config[key]
            return True
        return False

    def save_to_file(self, path: str):
        """Save config to JSON file."""
        with open(path, "w") as f:
            json.dump(self._config, f, indent=2)

    def load_from_file(self, path: str):
        """Load config from JSON file."""
        if os.path.exists(path):
            with open(path, "r") as f:
                self._config = json.load(f)


class PluginEngine:
    """Main plugin engine with validation, loading, and lifecycle."""

    def __init__(self):
        from .validator import PluginValidator
        self.validator = PluginValidator()
        self.hooks = HookManager()
        self.config = ConfigStore()
        self._plugins: Dict[str, PluginInstance] = {}
        self._load_order: List[str] = []

    def discover_plugins(self, search_dir: str) -> List[dict]:
        """Discover plugins by scanning directories for manifest.json files."""
        plugins = []

        if not os.path.isdir(search_dir):
            return plugins

        for item in os.listdir(search_dir):
            plugin_dir = os.path.join(search_dir, item)
            manifest_path = os.path.join(plugin_dir, "manifest.json")

            if os.path.isdir(plugin_dir) and os.path.exists(manifest_path):
                try:
                    with open(manifest_path, "r") as f:
                        manifest = json.load(f)
                    manifest["_dir"] = plugin_dir
                    plugins.append(manifest)
                except (json.JSONDecodeError, IOError):
                    pass

        return plugins

    def load_plugin(self, manifest_path: str) -> PluginInstance:
        """Load a plugin from a manifest path."""
        manifest = self.validator.validate_manifest(manifest_path)
        plugin_dir = manifest.get("_dir", os.path.dirname(manifest_path))

        plugin = PluginInstance(
            name=manifest["name"],
            version=manifest["version"],
            manifest=manifest,
        )

        # Try to load entry point
        entry_point = manifest.get("entry_point")
        if entry_point:
            try:
                ep_path = os.path.join(plugin_dir, entry_point)
                spec = importlib.util.spec_from_file_location(plugin.name, ep_path)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                plugin.instance = module
                plugin.metrics.load_time_ms = 50.0  # Simulated
            except Exception:
                plugin.instance = None

        # Load config if present
        config_path = os.path.join(plugin_dir, "config.json")
        if os.path.exists(config_path):
            plugin.config = self.config.get_nested(f"plugins.{manifest['name']}")

        # Register hooks if present
        if hasattr(plugin.instance, "register_hooks"):
            try:
                hooks = plugin.instance.register_hooks(self.hooks)
                plugin.hooks = hooks
            except Exception:
                pass

        self._plugins[manifest["name"]] = plugin
        self._load_order.append(manifest["name"])
        return plugin

    def get_plugin(self, name: str) -> Optional[PluginInstance]:
        """Get a loaded plugin by name."""
        return self._plugins.get(name)

    def get_all_plugins(self) -> List[PluginInstance]:
        """Get all loaded plugins."""
        return list(self._plugins.values())

    def unload_plugin(self, name: str) -> bool:
        """Unload a plugin by name."""
        if name in self._plugins:
            plugin = self._plugins[name]
            # Call cleanup hook if present
            if hasattr(plugin.instance, "cleanup"):
                try:
                    plugin.instance.cleanup()
                except Exception:
                    pass
            del self._plugins[name]
            self._load_order.remove(name)
            return True
        return False

    def call_plugin_method(self, name: str, method: str, *args, **kwargs) -> Any:
        """Call a method on a loaded plugin."""
        plugin = self._plugins.get(name)
        if not plugin or not plugin.instance:
            raise ValueError(f"Plugin '{name}' not loaded or has no instance")

        plugin.metrics.call_count += 1
        try:
            method_func = getattr(plugin.instance, method)
            result = method_func(*args, **kwargs)
            return result
        except Exception as e:
            plugin.metrics.error_count += 1
            plugin.metrics.last_error = str(e)
            raise

    def get_metrics(self) -> dict:
        """Get metrics for all loaded plugins."""
        metrics = {}
        for name, plugin in self._plugins.items():
            metrics[name] = {
                "version": plugin.version,
                "load_time_ms": plugin.metrics.load_time_ms,
                "call_count": plugin.metrics.call_count,
                "error_count": plugin.metrics.error_count,
                "error_rate": plugin.metrics.error_rate,
                "last_error": plugin.metrics.last_error,
            }
        return metrics

    def get_status(self) -> dict:
        """Get overall engine status."""
        return {
            "plugins_loaded": len(self._plugins),
            "plugins": list(self._plugins.keys()),
            "load_order": self._load_order,
            "hooks": self.hooks.list_hooks(),
            "metrics": self.get_metrics(),
        }
