"""
Phase 2 Tests — PluginEngine, HookManager, ConfigStore, PluginMetrics.
Target: 39 tests
"""
import os
import sys
import json
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine.core import (
    HookManager, ConfigStore, PluginMetrics, PluginInstance, PluginEngine
)
from engine.validator import ValidationError


class TestHookManager:
    """Test HookManager functionality."""

    def test_01_register_hook(self):
        h = HookManager()
        called = []
        h.register("test", lambda: called.append(1))
        assert len(called) == 0  # Not invoked yet

    def test_02_invoke_hook(self):
        h = HookManager()
        result = []
        h.register("test", lambda: result.append(1))
        h.invoke("test")
        assert result == [1]

    def test_03_invoke_multiple_callbacks(self):
        h = HookManager()
        results = []
        h.register("test", lambda: results.append("a"))
        h.register("test", lambda: results.append("b"))
        h.invoke("test")
        assert len(results) == 2
        assert "a" in results
        assert "b" in results

    def test_04_register_returns_none(self):
        h = HookManager()
        assert h.register("test", lambda: None) is None

    def test_05_unregister_hook(self):
        h = HookManager()
        cb = lambda: None
        h.register("test", cb)
        h.unregister("test", cb)
        assert len(h._hooks["test"]) == 0

    def test_06_invoke_nonexistent_hook(self):
        h = HookManager()
        results = h.invoke("nonexistent")
        assert results == []

    def test_07_hook_exception_handled(self):
        h = HookManager()
        h.register("test", lambda: 1/0)
        results = h.invoke("test")
        assert results == [None]

    def test_08_list_hooks(self):
        h = HookManager()
        h.register("a", lambda: None)
        h.register("a", lambda: None)
        h.register("b", lambda: None)
        hooks = h.list_hooks()
        assert hooks["a"] == 2
        assert hooks["b"] == 1

    def test_09_hook_with_args(self):
        h = HookManager()
        results = []
        h.register("test", lambda x, y: results.append(x + y))
        h.invoke("test", 3, 4)
        assert results == [7]

    def test_10_hook_with_kwargs(self):
        h = HookManager()
        results = []
        h.register("test", lambda **kw: results.append(kw))
        h.invoke("test", x=1, y=2)
        assert results == [{"x": 1, "y": 2}]

    def test_11_multiple_hooks_independent(self):
        h = HookManager()
        h.register("a", lambda: "a")
        h.register("b", lambda: "b")
        assert h.invoke("a") == ["a"]
        assert h.invoke("b") == ["b"]

    def test_12_unregister_nonexistent_hook(self):
        h = HookManager()
        cb = lambda: None
        h.unregister("test", cb)  # Should not error

    def test_13_hook_preserves_return_values(self):
        h = HookManager()
        h.register("test", lambda: 42)
        results = h.invoke("test")
        assert results == [42]


class TestConfigStore:
    """Test ConfigStore functionality."""

    def test_01_set_and_get(self):
        cs = ConfigStore()
        cs.set("key", "value")
        assert cs.get("key") == "value"

    def test_02_get_default(self):
        cs = ConfigStore()
        assert cs.get("missing", "default") == "default"

    def test_03_get_nested(self):
        cs = ConfigStore()
        cs._config = {"db": {"host": "localhost", "port": 5432}}
        assert cs.get_nested("db.host") == "localhost"
        assert cs.get_nested("db.port") == 5432

    def test_04_get_nested_default(self):
        cs = ConfigStore()
        cs._config = {"db": {"host": "localhost"}}
        assert cs.get_nested("db.port", "5432") == "5432"

    def test_05_set_nested(self):
        cs = ConfigStore()
        cs.set_nested("db.host", "localhost")
        assert cs.get_nested("db.host") == "localhost"

    def test_06_set_nested_creates_deep_path(self):
        cs = ConfigStore()
        cs.set_nested("a.b.c", 42)
        assert cs.get_nested("a.b.c") == 42

    def test_07_delete_key(self):
        cs = ConfigStore()
        cs.set("key", "value")
        assert cs.delete("key") is True
        assert cs.get("key") is None

    def test_08_delete_missing_key(self):
        cs = ConfigStore()
        assert cs.delete("missing") is False

    def test_09_save_load_json(self, tmp_path):
        cs = ConfigStore()
        cs.set("key", "value")
        cs.set_nested("db.port", 5432)
        path = str(tmp_path / "config.json")
        cs.save_to_file(path)
        cs2 = ConfigStore()
        cs2.load_from_file(path)
        assert cs2.get("key") == "value"
        assert cs2.get_nested("db.port") == 5432


class TestPluginMetrics:
    """Test PluginMetrics functionality."""

    def test_01_default_values(self):
        m = PluginMetrics()
        assert m.load_time_ms == 0.0
        assert m.call_count == 0
        assert m.error_count == 0
        assert m.last_error is None
        assert m.uptime_seconds == 0.0

    def test_02_error_rate_zero_calls(self):
        m = PluginMetrics()
        assert m.error_rate == 0.0

    def test_03_error_rate_with_calls(self):
        m = PluginMetrics()
        m.call_count = 10
        m.error_count = 2
        assert m.error_rate == 0.2

    def test_04_update_metrics(self):
        m = PluginMetrics()
        m.call_count += 5
        m.error_count += 1
        m.last_error = "test error"
        assert m.call_count == 5
        assert m.error_count == 1
        assert m.last_error == "test error"


class TestPluginInstance:
    """Test PluginInstance dataclass."""

    def test_01_create_instance(self):
        pi = PluginInstance(name="test", version="1.0", manifest={"name": "test"})
        assert pi.name == "test"
        assert pi.version == "1.0"

    def test_02_default_metrics(self):
        pi = PluginInstance(name="test", version="1.0", manifest={"name": "test"})
        assert isinstance(pi.metrics, PluginMetrics)

    def test_03_default_hooks_empty(self):
        pi = PluginInstance(name="test", version="1.0", manifest={"name": "test"})
        assert pi.hooks == {}

    def test_04_default_config_empty(self):
        pi = PluginInstance(name="test", version="1.0", manifest={"name": "test"})
        assert pi.config == {}


class TestPluginEngine:
    """Test PluginEngine integration."""

    def test_01_create_engine(self):
        engine = PluginEngine()
        assert engine is not None

    def test_02_discover_empty_dir(self):
        engine = PluginEngine()
        plugins = engine.discover_plugins("/nonexistent")
        assert plugins == []

    def test_03_status_empty(self):
        engine = PluginEngine()
        status = engine.get_status()
        assert status["plugins_loaded"] == 0
        assert status["plugins"] == []

    def test_04_get_metrics_empty(self):
        engine = PluginEngine()
        metrics = engine.get_metrics()
        assert metrics == {}

    def test_05_unload_nonexistent(self):
        engine = PluginEngine()
        assert engine.unload_plugin("missing") is False

    def test_06_get_nonexistent_plugin(self):
        engine = PluginEngine()
        assert engine.get_plugin("missing") is None

    def test_07_call_plugin_not_loaded(self):
        engine = PluginEngine()
        try:
            engine.call_plugin_method("missing", "method")
            assert False
        except ValueError:
            pass

    def test_08_call_plugin_with_args(self, tmp_path):
        """Test calling a plugin method with arguments."""
        # Create a minimal plugin
        plugin_dir = tmp_path / "testplugin"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "testplugin",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
            "entry_point": "main.py",
        }))
        (plugin_dir / "main.py").write_text("""
def greet(name):
    return f"Hello, {name}!"

def register_hooks(hooks):
    hooks.register("greet", lambda n: greet(n))
    return {}
""")
        engine = PluginEngine()
        plugin = engine.load_plugin(str(plugin_dir / "manifest.json"))
        result = engine.call_plugin_method("testplugin", "greet", "World")
        assert result == "Hello, World!"

    def test_09_get_all_plugins(self, tmp_path):
        engine = PluginEngine()
        assert engine.get_all_plugins() == []

    def test_10_metrics_track_calls(self, tmp_path):
        plugin_dir = tmp_path / "metricsplugin"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "metricsplugin",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
            "entry_point": "main.py",
        }))
        (plugin_dir / "main.py").write_text("""
def do_something():
    return 42
""")
        engine = PluginEngine()
        engine.load_plugin(str(plugin_dir / "manifest.json"))
        engine.call_plugin_method("metricsplugin", "do_something")
        engine.call_plugin_method("metricsplugin", "do_something")
        engine.call_plugin_method("metricsplugin", "do_something")
        metrics = engine.get_metrics()["metricsplugin"]
        assert metrics["call_count"] == 3


class TestHookIntegration:
    """Test hooks integrated with plugins."""

    def test_11_plugin_with_hooks(self, tmp_path):
        plugin_dir = tmp_path / "hookplugin"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "hookplugin",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
            "entry_point": "main.py",
        }))
        (plugin_dir / "main.py").write_text("""
def on_load(engine):
    pass

def register_hooks(hooks):
    hooks.register("loaded", lambda: "plugin loaded")
    return {"on_load": on_load}
""")
        engine = PluginEngine()
        engine.load_plugin(str(plugin_dir / "manifest.json"))
        assert "loaded" in engine.hooks.list_hooks()

    def test_12_engine_hooks_independent(self):
        engine = PluginEngine()
        engine.hooks.register("test", lambda: "from engine")
        assert engine.hooks.invoke("test") == ["from engine"]


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
