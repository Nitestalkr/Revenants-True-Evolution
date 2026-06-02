"""
Phase 2 Core Extension Tests — PluginEngine advanced, scaffold generator.
Brings Phase 2 total to 39.
"""
import os
import sys
import json
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine.core import (
    HookManager, ConfigStore, PluginMetrics, PluginInstance, PluginEngine
)
from engine.scaffold_generator import ScaffoldGenerator


class TestPluginEngineLoadUnload:
    """Test plugin load/unload lifecycle."""

    def test_01_load_and_get(self, tmp_path):
        plugin_dir = tmp_path / "loadtest"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "loadtest",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
            "entry_point": "main.py",
        }))
        (plugin_dir / "main.py").write_text("value = 42")
        engine = PluginEngine()
        plugin = engine.load_plugin(str(plugin_dir / "manifest.json"))
        assert plugin is not None
        assert plugin.name == "loadtest"

    def test_02_get_loaded_plugin(self, tmp_path):
        plugin_dir = tmp_path / "gettest"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "gettest",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
        }))
        engine = PluginEngine()
        engine.load_plugin(str(plugin_dir / "manifest.json"))
        plugin = engine.get_plugin("gettest")
        assert plugin is not None
        assert plugin.version == "1.0.0"

    def test_03_unload_plugin(self, tmp_path):
        plugin_dir = tmp_path / "unloadtest"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "unloadtest",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
        }))
        engine = PluginEngine()
        engine.load_plugin(str(plugin_dir / "manifest.json"))
        assert engine.get_plugin("unloadtest") is not None
        result = engine.unload_plugin("unloadtest")
        assert result is True
        assert engine.get_plugin("unloadtest") is None

    def test_04_multiple_plugins(self, tmp_path):
        engine = PluginEngine()
        for i in range(5):
            plugin_dir = tmp_path / f"plugin_{i}"
            plugin_dir.mkdir()
            (plugin_dir / "manifest.json").write_text(json.dumps({
                "name": f"plugin_{i}",
                "version": "1.0.0",
                "description": "test",
                "author": "test",
            }))
            engine.load_plugin(str(plugin_dir / "manifest.json"))
        assert engine.get_status()["plugins_loaded"] == 5
        plugins = engine.get_all_plugins()
        assert len(plugins) == 5

    def test_05_load_order_preserved(self, tmp_path):
        engine = PluginEngine()
        for i in [3, 1, 4, 0, 2]:
            plugin_dir = tmp_path / f"order_{i}"
            plugin_dir.mkdir()
            (plugin_dir / "manifest.json").write_text(json.dumps({
                "name": f"order_{i}",
                "version": "1.0.0",
                "description": "test",
                "author": "test",
            }))
            engine.load_plugin(str(plugin_dir / "manifest.json"))
        assert engine.get_status()["load_order"] == ["order_3", "order_1", "order_4", "order_0", "order_2"]


class TestPluginEngineDiscovery:
    """Test plugin discovery."""

    def test_06_discover_single_plugin(self, tmp_path):
        engine = PluginEngine()
        plugin_dir = tmp_path / "discovered"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "discovered",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
        }))
        plugins = engine.discover_plugins(str(tmp_path))
        assert len(plugins) == 1
        assert plugins[0]["name"] == "discovered"

    def test_07_discover_multiple_plugins(self, tmp_path):
        engine = PluginEngine()
        for i in range(3):
            plugin_dir = tmp_path / f"plugin_{i}"
            plugin_dir.mkdir()
            (plugin_dir / "manifest.json").write_text(json.dumps({
                "name": f"plugin_{i}",
                "version": "1.0.0",
                "description": "test",
                "author": "test",
            }))
        plugins = engine.discover_plugins(str(tmp_path))
        assert len(plugins) == 3
        names = [p["name"] for p in plugins]
        assert "plugin_0" in names

    def test_08_discover_skip_bad_manifest(self, tmp_path):
        engine = PluginEngine()
        # Good plugin
        good = tmp_path / "good_plugin"
        good.mkdir()
        (good / "manifest.json").write_text(json.dumps({
            "name": "good_plugin",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
        }))
        # Bad plugin (invalid JSON)
        bad = tmp_path / "bad_plugin"
        bad.mkdir()
        (bad / "manifest.json").write_text("{bad json")
        plugins = engine.discover_plugins(str(tmp_path))
        assert len(plugins) == 1
        assert plugins[0]["name"] == "good_plugin"

    def test_09_discover_skip_non_dir(self, tmp_path):
        engine = PluginEngine()
        plugin_dir = tmp_path / "discovered"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "discovered",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
        }))
        # Create a file that's not a directory
        (tmp_path / "not_a_dir.txt").write_text("hello")
        plugins = engine.discover_plugins(str(tmp_path))
        assert len(plugins) == 1


class TestPluginEngineCallMethods:
    """Test plugin method invocation."""

    def test_10_call_method_success(self, tmp_path):
        plugin_dir = tmp_path / "methodtest"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "methodtest",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
            "entry_point": "main.py",
        }))
        (plugin_dir / "main.py").write_text("def add(a, b): return a + b")
        engine = PluginEngine()
        engine.load_plugin(str(plugin_dir / "manifest.json"))
        result = engine.call_plugin_method("methodtest", "add", 3, 4)
        assert result == 7

    def test_11_call_method_no_args(self, tmp_path):
        plugin_dir = tmp_path / "noargs"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "noargs",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
            "entry_point": "main.py",
        }))
        (plugin_dir / "main.py").write_text("def hello(): return 'hi'")
        engine = PluginEngine()
        engine.load_plugin(str(plugin_dir / "manifest.json"))
        result = engine.call_plugin_method("noargs", "hello")
        assert result == "hi"

    def test_12_call_method_exception(self, tmp_path):
        plugin_dir = tmp_path / "errortest"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "errortest",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
            "entry_point": "main.py",
        }))
        (plugin_dir / "main.py").write_text("def crash(): raise ValueError('boom')")
        engine = PluginEngine()
        engine.load_plugin(str(plugin_dir / "manifest.json"))
        try:
            engine.call_plugin_method("errortest", "crash")
            assert False
        except ValueError:
            pass

    def test_13_error_count_increments_on_crash(self, tmp_path):
        plugin_dir = tmp_path / "errcount"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "errcount",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
            "entry_point": "main.py",
        }))
        (plugin_dir / "main.py").write_text("def fail(): raise RuntimeError('fail')")
        engine = PluginEngine()
        engine.load_plugin(str(plugin_dir / "manifest.json"))
        for _ in range(3):
            try:
                engine.call_plugin_method("errcount", "fail")
            except RuntimeError:
                pass
        metrics = engine.get_metrics()["errcount"]
        assert metrics["error_count"] == 3


class TestPluginMetricsIntegration:
    """Test metrics integration with PluginEngine."""

    def test_14_load_time_tracked(self, tmp_path):
        plugin_dir = tmp_path / "loadtime"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "loadtime",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
            "entry_point": "main.py",
        }))
        (plugin_dir / "main.py").write_text("")
        engine = PluginEngine()
        engine.load_plugin(str(plugin_dir / "manifest.json"))
        metrics = engine.get_metrics()["loadtime"]
        assert metrics["load_time_ms"] >= 0

    def test_15_error_rate_computed(self, tmp_path):
        plugin_dir = tmp_path / "erratetest"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "erratetest",
            "version": "1.0.0",
            "description": "test",
            "author": "test",
            "entry_point": "main.py",
        }))
        (plugin_dir / "main.py").write_text("""
def ok(): return True
def fail(): raise ValueError("x")
""")
        engine = PluginEngine()
        engine.load_plugin(str(plugin_dir / "manifest.json"))
        engine.call_plugin_method("erratetest", "ok")
        try:
            engine.call_plugin_method("erratetest", "fail")
        except ValueError:
            pass
        try:
            engine.call_plugin_method("erratetest", "fail")
        except ValueError:
            pass
        metrics = engine.get_metrics()["erratetest"]
        assert metrics["call_count"] == 3
        assert metrics["error_count"] == 2


class TestScaffoldGenerator:
    """Test scaffold generation."""

    def test_16_generate_basic(self, tmp_path):
        sg = ScaffoldGenerator()
        result = sg.generate("myplugin", str(tmp_path), template="basic")
        assert os.path.exists(result)
        with open(result) as f:
            manifest = json.load(f)
        assert manifest["name"] == "myplugin"

    def test_17_generate_with_tests(self, tmp_path):
        sg = ScaffoldGenerator()
        sg.generate("testplugin", str(tmp_path), template="with_tests")
        main = tmp_path / "testplugin" / "main.py"
        test = tmp_path / "testplugin" / "tests" / "test_main.py"
        assert main.exists()
        assert test.exists()

    def test_18_generate_with_config(self, tmp_path):
        sg = ScaffoldGenerator()
        sg.generate("confplugin", str(tmp_path), template="with_config")
        config = tmp_path / "confplugin" / "config.json"
        assert config.exists()
        with open(config) as f:
            assert json.load(f) == {}

    def test_19_validate_good_scaffold(self, tmp_path):
        sg = ScaffoldGenerator()
        sg.generate("validplugin", str(tmp_path))
        plugin_dir = tmp_path / "validplugin"
        result = sg.validate_scaffold(str(plugin_dir))
        assert result["valid"] is True

    def test_20_validate_bad_scaffold(self, tmp_path):
        sg = ScaffoldGenerator()
        empty = tmp_path / "invalid"
        empty.mkdir()
        result = sg.validate_scaffold(str(empty))
        assert result["valid"] is False

    def test_21_generate_with_custom_fields(self, tmp_path):
        sg = ScaffoldGenerator()
        sg.generate("custom", str(tmp_path),
                     description="Custom description",
                     tags=["custom", "test"])
        manifest_path = tmp_path / "custom" / "manifest.json"
        with open(manifest_path) as f:
            manifest = json.load(f)
        assert manifest["description"] == "Custom description"
        assert manifest["tags"] == ["custom", "test"]

    def test_22_default_version(self, tmp_path):
        sg = ScaffoldGenerator()
        sg.generate("versiontest", str(tmp_path))
        manifest_path = tmp_path / "versiontest" / "manifest.json"
        with open(manifest_path) as f:
            manifest = json.load(f)
        assert manifest["version"] == "0.1.0"

    def test_23_default_entry_point(self, tmp_path):
        sg = ScaffoldGenerator()
        sg.generate("entrytest", str(tmp_path))
        manifest_path = tmp_path / "entrytest" / "manifest.json"
        with open(manifest_path) as f:
            manifest = json.load(f)
        assert manifest["entry_point"] == "main.py"


class TestConfigStoreAdvanced:
    """Advanced ConfigStore tests."""

    def test_24_overwrite_value(self):
        cs = ConfigStore()
        cs.set("key", "old")
        cs.set("key", "new")
        assert cs.get("key") == "new"

    def test_25_deep_nested_set(self):
        cs = ConfigStore()
        cs.set_nested("a.b.c.d.e", 42)
        assert cs.get_nested("a.b.c.d.e") == 42

    def test_26_overwrite_nested_value(self):
        cs = ConfigStore()
        cs.set_nested("a.b.c", 1)
        cs.set_nested("a.b.c", 2)
        assert cs.get_nested("a.b.c") == 2

    def test_27_save_load_preserves_types(self, tmp_path):
        cs = ConfigStore()
        cs.set("string", "hello")
        cs.set("number", 42)
        cs.set("bool", True)
        cs.set("list", [1, 2, 3])
        path = str(tmp_path / "config.json")
        cs.save_to_file(path)
        cs2 = ConfigStore()
        cs2.load_from_file(path)
        assert cs2.get("string") == "hello"
        assert cs2.get("number") == 42
        assert cs2.get("bool") is True
        assert cs2.get("list") == [1, 2, 3]

    def test_28_load_empty_file(self, tmp_path):
        cs = ConfigStore()
        path = tmp_path / "empty.json"
        path.write_text("{}")
        cs.load_from_file(str(path))
        assert cs._config == {}

    def test_29_load_nonexistent_file_noop(self):
        cs = ConfigStore()
        cs.set("existing", "value")
        cs.load_from_file("/nonexistent/path.json")
        assert cs.get("existing") == "value"


class TestPluginEngineStatus:
    """Test engine status reporting."""

    def test_30_empty_status(self):
        engine = PluginEngine()
        status = engine.get_status()
        assert status["plugins_loaded"] == 0
        assert status["plugins"] == []
        assert status["load_order"] == []
        assert status["hooks"] == {}

    def test_31_loaded_status(self, tmp_path):
        plugin_dir = tmp_path / "statustest"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "statustest",
            "version": "2.0.0",
            "description": "test",
            "author": "test",
        }))
        engine = PluginEngine()
        engine.load_plugin(str(plugin_dir / "manifest.json"))
        status = engine.get_status()
        assert status["plugins_loaded"] == 1
        assert "statustest" in status["plugins"]
        assert status["metrics"]["statustest"]["version"] == "2.0.0"


class TestPluginInstanceDataclass:
    """Test PluginInstance dataclass behavior."""

    def test_32_instance_with_none_instance(self):
        pi = PluginInstance(
            name="test",
            version="1.0.0",
            manifest={"name": "test"},
            instance=None,
        )
        assert pi.instance is None

    def test_33_instance_with_custom_config(self):
        pi = PluginInstance(
            name="test",
            version="1.0.0",
            manifest={"name": "test"},
            config={"setting": "value"},
        )
        assert pi.config["setting"] == "value"

    def test_34_instance_with_hooks(self):
        pi = PluginInstance(
            name="test",
            version="1.0.0",
            manifest={"name": "test"},
            hooks={"on_load": lambda: None},
        )
        assert "on_load" in pi.hooks


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
