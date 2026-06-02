"""
PluginValidator — Phase 1: Core validation system.

Validates plugin manifests, checks structure, ensures quality gates.
"""

import os
import json
import hashlib
from typing import Any, Dict, List, Optional


class ValidationError(Exception):
    """Raised when a plugin fails validation."""
    def __init__(self, field: str, message: str):
        self.field = field
        self.message = message
        super().__init__(f"Validation error in '{field}': {message}")


class PluginValidator:
    """Validates plugin manifests, structure, and quality gates."""

    REQUIRED_MANIFEST_FIELDS = {
        "name": str,
        "version": str,
        "description": str,
        "author": str,
    }

    OPTIONAL_MANIFEST_FIELDS = {
        "homepage": str,
        "tags": list,
        "min_runtime_version": str,
        "max_runtime_version": str,
        "dependencies": list,
        "entry_point": str,
    }

    ALLOWED_ENTRY_POINT_EXTENSIONS = (".py", ".js", ".ts")

    def __init__(self):
        self._errors: List[ValidationError] = []
        self._warnings: List[str] = []

    @property
    def errors(self) -> List[ValidationError]:
        return self._errors

    @property
    def warnings(self) -> List[str]:
        return self._warnings

    def validate_manifest(self, manifest_path: str) -> dict:
        """Validate plugin manifest JSON file.

        Returns validated manifest dict or raises ValidationError.
        """
        self._errors.clear()
        self._warnings.clear()

        if not os.path.exists(manifest_path):
            raise ValidationError("file", f"Manifest not found: {manifest_path}")

        try:
            with open(manifest_path, "r") as f:
                manifest = json.load(f)
        except json.JSONDecodeError as e:
            raise ValidationError("json", f"Invalid JSON: {e}")

        self._validate_required_fields(manifest)
        self._validate_optional_fields(manifest)
        self._validate_version_format(manifest)
        self._validate_entry_point(manifest)

        if self._errors:
            raise ValidationError("manifest", f"{len(self._errors)} validation errors found")

        if self._warnings:
            for w in self._warnings:
                pass  # Warnings don't block

        return manifest

    def validate_manifest_data(self, manifest_data: dict) -> dict:
        """Validate plugin manifest from dict (not file path)."""
        self._errors.clear()
        self._warnings.clear()

        if not isinstance(manifest_data, dict):
            raise ValidationError("type", "Manifest must be a dict")

        self._validate_required_fields(manifest_data)
        self._validate_optional_fields(manifest_data)
        self._validate_version_format(manifest_data)
        self._validate_entry_point(manifest_data)

        if self._errors:
            raise ValidationError("manifest", f"{len(self._errors)} validation errors found")

        return manifest_data

    def _validate_required_fields(self, manifest: dict):
        """Check all required fields are present with correct types."""
        for field, expected_type in self.REQUIRED_MANIFEST_FIELDS.items():
            if field not in manifest:
                self._errors.append(ValidationError(field, f"Required field missing"))
            elif not isinstance(manifest[field], expected_type):
                self._errors.append(
                    ValidationError(
                        field,
                        f"Expected {expected_type.__name__}, got {type(manifest[field]).__name__}"
                    )
                )
            elif not manifest[field].strip():
                self._errors.append(ValidationError(field, "Field must not be empty"))

    def _validate_optional_fields(self, manifest: dict):
        """Check optional fields have correct types."""
        for field, expected_type in self.OPTIONAL_MANIFEST_FIELDS.items():
            if field in manifest and manifest[field] is not None:
                if not isinstance(manifest[field], expected_type):
                    self._warnings.append(
                        f"Optional field '{field}': expected {expected_type.__name__}, "
                        f"got {type(manifest[field]).__name__}"
                    )

    def _validate_version_format(self, manifest: dict):
        """Validate version is semver-like (major.minor.patch)."""
        version = manifest.get("version", "")
        if not isinstance(version, str):
            return  # Type already caught by required fields check
        parts = version.split(".")
        if len(parts) != 3:
            self._warnings.append(
                f"Version '{version}' should follow semver (major.minor.patch)"
            )
        for part in parts:
            if not part.isdigit():
                self._warnings.append(
                    f"Version parts should be numeric, got '{part}'"
                )

    def _validate_entry_point(self, manifest: dict):
        """Validate entry point field if present."""
        entry = manifest.get("entry_point")
        if entry is not None:
            if not isinstance(entry, str):
                self._errors.append(ValidationError("entry_point", "Must be a string"))
            elif entry and not any(entry.endswith(ext) for ext in self.ALLOWED_ENTRY_POINT_EXTENSIONS):
                self._warnings.append(
                    f"Entry point '{entry}' should end with {self.ALLOWED_ENTRY_POINT_EXTENSIONS}"
                )

    def validate_directory_structure(self, plugin_dir: str) -> List[str]:
        """Validate plugin directory has required structure.

        Returns list of issues found.
        """
        issues = []

        if not os.path.isdir(plugin_dir):
            issues.append(f"Directory not found: {plugin_dir}")
            return issues

        # Check for manifest
        manifest_path = os.path.join(plugin_dir, "manifest.json")
        if not os.path.exists(manifest_path):
            issues.append("Missing manifest.json")

        # Check for entry point
        try:
            with open(manifest_path, "r") as f:
                manifest = json.load(f)
            entry_point = manifest.get("entry_point")
            if entry_point:
                ep_path = os.path.join(plugin_dir, entry_point)
                if not os.path.exists(ep_path):
                    issues.append(f"Entry point not found: {entry_point}")
        except Exception:
            pass  # Already caught by manifest check

        return issues

    def compute_hash(self, file_path: str) -> str:
        """Compute SHA-256 hash of a file."""
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                sha256.update(chunk)
        return sha256.hexdigest()

    def validate_quality_gates(self, plugin_dir: str) -> dict:
        """Run quality gate checks on plugin directory.

        Returns dict with gate results.
        """
        gates = {
            "has_manifest": False,
            "manifest_valid": False,
            "has_entry_point": False,
            "has_tests": False,
            "has_readme": False,
            "has_license": False,
            "structure_valid": True,
            "issues": [],
        }

        # Check manifest
        manifest_path = os.path.join(plugin_dir, "manifest.json")
        gates["has_manifest"] = os.path.exists(manifest_path)

        if gates["has_manifest"]:
            try:
                manifest = self.validate_manifest(manifest_path)
                gates["manifest_valid"] = True
            except (ValidationError, json.JSONDecodeError):
                pass

        # Check entry point
        if os.path.isfile(manifest_path):
            try:
                with open(manifest_path, "r") as f:
                    manifest = json.load(f)
                entry = manifest.get("entry_point")
                if entry:
                    gates["has_entry_point"] = os.path.exists(os.path.join(plugin_dir, entry))
            except Exception:
                pass

        # Check for tests
        tests_dir = os.path.join(plugin_dir, "tests")
        gates["has_tests"] = os.path.isdir(tests_dir) and any(
            f.startswith("test_") for f in os.listdir(tests_dir)
        )

        # Check for docs
        gates["has_readme"] = os.path.exists(os.path.join(plugin_dir, "README.md"))
        gates["has_license"] = os.path.exists(os.path.join(plugin_dir, "LICENSE"))

        return gates
