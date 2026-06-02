"""
Phase 1 Extension Tests — Extra validator edge cases.
Brings Phase 1 total to 47.
"""
import os
import sys
import json
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine.validator import PluginValidator, ValidationError


class TestValidateManifestMultipleErrors:
    """Test when multiple validation errors exist."""

    def test_01_multiple_missing_fields(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({"name": "test"}))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError as e:
            assert "validation errors found" in e.message

    def test_02_error_count_multiple(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({"name": "test"}))
        try:
            v.validate_manifest(str(mf))
        except ValidationError as e:
            error_count = e.message.count("validation errors")
            assert error_count >= 1


class TestValidateDirectoryStructureExtra:
    """Extended directory structure tests."""

    def test_03_valid_structure_no_entry(self, tmp_path):
        """Directory is valid even without entry point file (entry point is optional)."""
        v = PluginValidator()
        plugin_dir = tmp_path / "myplugin"
        plugin_dir.mkdir()
        mf = plugin_dir / "manifest.json"
        mf.write_text(json.dumps({
            "name": "myplugin",
            "version": "1.0.0",
            "description": "desc",
            "author": "auth",
        }))
        issues = v.validate_directory_structure(str(plugin_dir))
        assert len(issues) == 0

    def test_04_entry_point_file_missing_warns(self, tmp_path):
        v = PluginValidator()
        plugin_dir = tmp_path / "myplugin"
        plugin_dir.mkdir()
        mf = plugin_dir / "manifest.json"
        mf.write_text(json.dumps({
            "name": "myplugin",
            "version": "1.0.0",
            "description": "desc",
            "author": "auth",
            "entry_point": "missing.py",
        }))
        issues = v.validate_directory_structure(str(plugin_dir))
        assert any("missing" in i for i in issues)


class TestQualityGatesEdgeCases:
    """Extended quality gate tests."""

    def test_05_no_tests_directory(self, tmp_path):
        v = PluginValidator()
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "p", "version": "1.0.0",
            "description": "d", "author": "a",
        }))
        gates = v.validate_quality_gates(str(plugin_dir))
        assert gates["has_tests"] is False

    def test_06_tests_without_test_prefix(self, tmp_path):
        v = PluginValidator()
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "p", "version": "1.0.0",
            "description": "d", "author": "a",
        }))
        tests_dir = plugin_dir / "tests"
        tests_dir.mkdir()
        (tests_dir / "main.py").write_text("")  # No test_ prefix
        gates = v.validate_quality_gates(str(plugin_dir))
        assert gates["has_tests"] is False

    def test_07_valid_tests_with_prefix(self, tmp_path):
        v = PluginValidator()
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "p", "version": "1.0.0",
            "description": "d", "author": "a",
        }))
        tests_dir = plugin_dir / "tests"
        tests_dir.mkdir()
        (tests_dir / "test_example.py").write_text("")
        gates = v.validate_quality_gates(str(plugin_dir))
        assert gates["has_tests"] is True


class TestValidationStateManagement:
    """Test that validation state is properly cleared between calls."""

    def test_08_errors_cleared_between_calls(self, tmp_path):
        v = PluginValidator()
        mf_bad = tmp_path / "bad.json"
        mf_bad.write_text(json.dumps({"name": "test"}))
        mf_good = tmp_path / "good.json"
        mf_good.write_text(json.dumps({
            "name": "test", "version": "1.0.0",
            "description": "d", "author": "a",
        }))
        # First call: bad manifest
        try:
            v.validate_manifest(str(mf_bad))
        except ValidationError:
            pass
        # Errors should exist
        assert len(v.errors) > 0
        # Second call: good manifest
        v.validate_manifest(str(mf_good))
        # Errors should be cleared
        assert len(v.errors) == 0

    def test_09_warnings_cleared_between_calls(self, tmp_path):
        v = PluginValidator()
        mf_warn = tmp_path / "warn.json"
        mf_warn.write_text(json.dumps({
            "name": "test", "version": "1.2",
            "description": "d", "author": "a",
        }))
        mf_no_warn = tmp_path / "nowarn.json"
        mf_no_warn.write_text(json.dumps({
            "name": "test", "version": "1.2.3",
            "description": "d", "author": "a",
        }))
        v.validate_manifest(str(mf_warn))
        assert len(v.warnings) > 0
        v.validate_manifest(str(mf_no_warn))
        assert len(v.warnings) == 0

    def test_10_errors_list_is_independent(self, tmp_path):
        v = PluginValidator()
        mf_bad = tmp_path / "bad.json"
        mf_bad.write_text(json.dumps({"name": 123}))
        try:
            v.validate_manifest(str(mf_bad))
        except ValidationError:
            pass
        error_count1 = len(v.errors)
        assert error_count1 > 0
        mf_good = tmp_path / "good.json"
        mf_good.write_text(json.dumps({
            "name": "test", "version": "1.0.0",
            "description": "d", "author": "a",
        }))
        v.validate_manifest(str(mf_good))
        assert len(v.errors) == 0  # Errors cleared


class TestEdgeCases:
    """Edge case testing."""

    def test_11_version_with_special_chars(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test", "version": "v1.2.3",
            "description": "d", "author": "a",
        }))
        v.validate_manifest(str(mf))
        # Should produce warnings for non-numeric part
        assert len(v.warnings) > 0

    def test_12_empty_manifest_file(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text("")
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError as e:
            assert e.field == "json"

    def test_13_manifest_with_extra_fields(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test", "version": "1.0.0",
            "description": "d", "author": "a",
            "custom_field": "custom_value",
            "another_extra": 42,
        }))
        result = v.validate_manifest(str(mf))
        assert result["name"] == "test"
        # Extra fields are returned as-is (they don't cause errors)

    def test_14_author_with_whitespace(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test", "version": "1.0.0",
            "description": "d", "author": "   ",
        }))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError:
            pass

    def test_15_version_edge_single_digit(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test", "version": "0.0.0",
            "description": "d", "author": "a",
        }))
        result = v.validate_manifest(str(mf))
        assert result["version"] == "0.0.0"


class TestValidateManifestDataEdgeCases:
    """Edge cases for dict-based validation."""

    def test_16_none_manifest_raises(self):
        v = PluginValidator()
        try:
            v.validate_manifest_data(None)
            assert False
        except (ValidationError, TypeError):
            pass

    def test_17_list_manifest_raises(self):
        v = PluginValidator()
        try:
            v.validate_manifest_data(["not", "a", "dict"])
            assert False
        except ValidationError as e:
            assert e.field == "type"

    def test_18_empty_dict_raises(self):
        v = PluginValidator()
        try:
            v.validate_manifest_data({})
            assert False
        except ValidationError:
            pass

    def test_19_all_optional_none(self, tmp_path):
        v = PluginValidator()
        manifest = {
            "name": "test", "version": "1.0.0",
            "description": "d", "author": "a",
            "homepage": None,
            "tags": None,
        }
        result = v.validate_manifest_data(manifest)
        assert result["name"] == "test"


class TestEntryPointValidationEdgeCases:
    """Additional entry point validation edge cases."""

    def test_20_js_extension_ok(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test", "version": "1.0.0",
            "description": "d", "author": "a",
            "entry_point": "index.js",
        }))
        result = v.validate_manifest(str(mf))
        assert result["entry_point"] == "index.js"

    def test_21_ts_extension_ok(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test", "version": "1.0.0",
            "description": "d", "author": "a",
            "entry_point": "index.ts",
        }))
        result = v.validate_manifest(str(mf))
        assert result["entry_point"] == "index.ts"

    def test_22_dot_py_extension_ok(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test", "version": "1.0.0",
            "description": "d", "author": "a",
            "entry_point": "lib/plugin.py",
        }))
        result = v.validate_manifest(str(mf))
        assert result["entry_point"] == "lib/plugin.py"


class TestMultipleValidationErrors:
    """Test behavior when multiple fields fail validation."""

    def test_23_multiple_type_errors(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": 123, "version": ["not", "a", "string"],
            "description": True, "author": 999,
        }))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError as e:
            assert "errors found" in e.message

    def test_24_multiple_empty_fields(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "", "version": "   ",
            "description": "", "author": "\t",
        }))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError:
            pass


class TestHashStability:
    """Test hash computation stability."""

    def test_25_hash_deterministic(self, tmp_path):
        v = PluginValidator()
        f = tmp_path / "stable.txt"
        f.write_text("stable content")
        h1 = v.compute_hash(str(f))
        h2 = v.compute_hash(str(f))
        assert h1 == h2

    def test_26_hash_content_dependent(self, tmp_path):
        v = PluginValidator()
        f1 = tmp_path / "a.txt"
        f2 = tmp_path / "b.txt"
        f1.write_text("content A")
        f2.write_text("content B")
        assert v.compute_hash(str(f1)) != v.compute_hash(str(f2))


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
