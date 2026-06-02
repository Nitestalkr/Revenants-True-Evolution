"""
Phase 1 Tests — PluginValidator core validation system.
Target: 47 tests
"""
import os
import sys
import json
import tempfile
import shutil

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine.validator import PluginValidator, ValidationError


class TestPluginValidatorInit:
    """Test validator initialization."""

    def test_01_create_validator(self):
        v = PluginValidator()
        assert v is not None

    def test_02_errors_empty_init(self):
        v = PluginValidator()
        assert v.errors == []

    def test_03_warnings_empty_init(self):
        v = PluginValidator()
        assert v.warnings == []

    def test_04_required_fields_constant(self):
        v = PluginValidator()
        assert isinstance(v.REQUIRED_MANIFEST_FIELDS, dict)
        assert "name" in v.REQUIRED_MANIFEST_FIELDS
        assert "version" in v.REQUIRED_MANIFEST_FIELDS
        assert "description" in v.REQUIRED_MANIFEST_FIELDS
        assert "author" in v.REQUIRED_MANIFEST_FIELDS

    def test_05_optional_fields_constant(self):
        v = PluginValidator()
        assert isinstance(v.OPTIONAL_MANIFEST_FIELDS, dict)
        assert "homepage" in v.OPTIONAL_MANIFEST_FIELDS


class TestValidateManifestMissingFile:
    """Test manifest validation with missing file."""

    def test_06_missing_file_raises(self):
        v = PluginValidator()
        try:
            v.validate_manifest("/nonexistent/manifest.json")
            assert False, "Should have raised ValidationError"
        except ValidationError as e:
            assert e.field == "file"

    def test_07_missing_file_message(self):
        v = PluginValidator()
        try:
            v.validate_manifest("/nonexistent/manifest.json")
            assert False
        except ValidationError as e:
            assert "not found" in e.message


class TestValidateManifestInvalidJSON:
    """Test manifest validation with invalid JSON."""

    def test_08_invalid_json_raises(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text("{bad json here")
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError as e:
            assert e.field == "json"


class TestValidateRequiredFields:
    """Test required field validation."""

    def test_09_all_required_present(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test-plugin",
            "version": "1.0.0",
            "description": "A test plugin",
            "author": "Test Author",
        }))
        result = v.validate_manifest(str(mf))
        assert result["name"] == "test-plugin"

    def test_10_missing_name_raises(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "version": "1.0.0",
            "description": "A test plugin",
            "author": "Test Author",
        }))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError:
            pass

    def test_11_missing_version_raises(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test-plugin",
            "description": "A test plugin",
            "author": "Test Author",
        }))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError:
            pass

    def test_12_missing_description_raises(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test-plugin",
            "version": "1.0.0",
            "author": "Test Author",
        }))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError:
            pass

    def test_13_missing_author_raises(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test-plugin",
            "version": "1.0.0",
            "description": "A test plugin",
        }))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError:
            pass

    def test_14_empty_name_raises(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "   ",
            "version": "1.0.0",
            "description": "A test plugin",
            "author": "Test Author",
        }))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError:
            pass

    def test_15_empty_description_raises(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test-plugin",
            "version": "1.0.0",
            "description": "",
            "author": "Test Author",
        }))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError:
            pass

    def test_16_wrong_type_name(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": 123,
            "version": "1.0.0",
            "description": "A test plugin",
            "author": "Test Author",
        }))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError:
            pass

    def test_17_wrong_type_version(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test-plugin",
            "version": 123,
            "description": "A test plugin",
            "author": "Test Author",
        }))
        try:
            v.validate_manifest(str(mf))
            assert False
        except ValidationError:
            pass


class TestValidateOptionalFields:
    """Test optional field validation."""

    def test_18_optional_fields_ok(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test-plugin",
            "version": "1.0.0",
            "description": "A test plugin",
            "author": "Test Author",
            "homepage": "https://example.com",
            "tags": ["test", "plugin"],
            "dependencies": [],
        }))
        result = v.validate_manifest(str(mf))
        assert result["homepage"] == "https://example.com"

    def test_19_no_optional_fields(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "minimal",
            "version": "0.1.0",
            "description": "Minimal plugin",
            "author": "Test",
        }))
        result = v.validate_manifest(str(mf))
        assert result["name"] == "minimal"

    def test_20_empty_tags_is_ok(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test",
            "version": "1.0.0",
            "description": "desc",
            "author": "auth",
            "tags": [],
        }))
        result = v.validate_manifest(str(mf))
        assert result["name"] == "test"


class TestValidateVersionFormat:
    """Test version format validation."""

    def test_21_valid_semver(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test",
            "version": "1.2.3",
            "description": "desc",
            "author": "auth",
        }))
        result = v.validate_manifest(str(mf))
        assert result["version"] == "1.2.3"

    def test_22_non_semver_warns(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test",
            "version": "1.2",
            "description": "desc",
            "author": "auth",
        }))
        v.validate_manifest(str(mf))
        assert len(v.warnings) > 0

    def test_23_version_with_letters_warns(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test",
            "version": "1.0.0-beta",
            "description": "desc",
            "author": "auth",
        }))
        v.validate_manifest(str(mf))
        assert len(v.warnings) > 0


class TestValidateEntryPoint:
    """Test entry point validation."""

    def test_24_valid_entry_point(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test",
            "version": "1.0.0",
            "description": "desc",
            "author": "auth",
            "entry_point": "main.py",
        }))
        result = v.validate_manifest(str(mf))
        assert result["entry_point"] == "main.py"

    def test_25_no_entry_point_ok(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test",
            "version": "1.0.0",
            "description": "desc",
            "author": "auth",
        }))
        result = v.validate_manifest(str(mf))
        assert "entry_point" not in result

    def test_26_bad_extension_warns(self, tmp_path):
        v = PluginValidator()
        mf = tmp_path / "manifest.json"
        mf.write_text(json.dumps({
            "name": "test",
            "version": "1.0.0",
            "description": "desc",
            "author": "auth",
            "entry_point": "main.exe",
        }))
        v.validate_manifest(str(mf))
        assert len(v.warnings) > 0


class TestManifestDataValidation:
    """Test validate_manifest_data (dict input)."""

    def test_27_valid_dict_manifest(self):
        v = PluginValidator()
        manifest = {
            "name": "test",
            "version": "1.0.0",
            "description": "desc",
            "author": "auth",
        }
        result = v.validate_manifest_data(manifest)
        assert result["name"] == "test"

    def test_28_invalid_type_raises(self):
        v = PluginValidator()
        try:
            v.validate_manifest_data("not a dict")
            assert False
        except ValidationError as e:
            assert e.field == "type"

    def test_29_missing_required_in_dict(self):
        v = PluginValidator()
        try:
            v.validate_manifest_data({"name": "test"})
            assert False
        except ValidationError:
            pass


class TestValidateDirectoryStructure:
    """Test directory structure validation."""

    def test_30_nonexistent_dir(self):
        v = PluginValidator()
        issues = v.validate_directory_structure("/nonexistent/path")
        assert len(issues) > 0

    def test_31_missing_manifest(self, tmp_path):
        v = PluginValidator()
        plugin_dir = tmp_path / "myplugin"
        plugin_dir.mkdir()
        issues = v.validate_directory_structure(str(plugin_dir))
        assert any("manifest" in i for i in issues)

    def test_32_valid_structure(self, tmp_path):
        v = PluginValidator()
        plugin_dir = tmp_path / "myplugin"
        plugin_dir.mkdir()
        mf = plugin_dir / "manifest.json"
        mf.write_text(json.dumps({
            "name": "myplugin",
            "version": "1.0.0",
            "description": "desc",
            "author": "auth",
            "entry_point": "main.py",
        }))
        ep = plugin_dir / "main.py"
        ep.write_text("")
        issues = v.validate_directory_structure(str(plugin_dir))
        assert len(issues) == 0


class TestComputeHash:
    """Test file hash computation."""

    def test_33_compute_hash_returns_string(self, tmp_path):
        v = PluginValidator()
        test_file = tmp_path / "test.txt"
        test_file.write_text("hello world")
        h = v.compute_hash(str(test_file))
        assert isinstance(h, str)
        assert len(h) == 64  # SHA-256 hex digest

    def test_34_same_content_same_hash(self, tmp_path):
        v = PluginValidator()
        f1 = tmp_path / "a.txt"
        f2 = tmp_path / "b.txt"
        f1.write_text("identical")
        f2.write_text("identical")
        assert v.compute_hash(str(f1)) == v.compute_hash(str(f2))

    def test_35_different_content_different_hash(self, tmp_path):
        v = PluginValidator()
        f1 = tmp_path / "a.txt"
        f2 = tmp_path / "b.txt"
        f1.write_text("content1")
        f2.write_text("content2")
        assert v.compute_hash(str(f1)) != v.compute_hash(str(f2))


class TestValidateQualityGates:
    """Test quality gate validation."""

    def test_36_all_gates_pass(self, tmp_path):
        v = PluginValidator()
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()
        (plugin_dir / "manifest.json").write_text(json.dumps({
            "name": "p", "version": "1.0.0",
            "description": "d", "author": "a",
        }))
        (plugin_dir / "README.md").write_text("# README")
        (plugin_dir / "LICENSE").write_text("MIT")
        tests_dir = plugin_dir / "tests"
        tests_dir.mkdir()
        (tests_dir / "test_main.py").write_text("")
        gates = v.validate_quality_gates(str(plugin_dir))
        assert gates["has_manifest"] is True
        assert gates["manifest_valid"] is True
        assert gates["has_readme"] is True
        assert gates["has_license"] is True
        assert gates["has_tests"] is True

    def test_37_missing_all_gates(self, tmp_path):
        v = PluginValidator()
        plugin_dir = tmp_path / "empty"
        plugin_dir.mkdir()
        gates = v.validate_quality_gates(str(plugin_dir))
        assert gates["has_manifest"] is False
        assert gates["has_readme"] is False
        assert gates["has_license"] is False


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
