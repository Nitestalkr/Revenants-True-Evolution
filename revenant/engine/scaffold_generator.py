"""
ScaffoldGenerator — Utility for generating new plugin skeletons.

Creates properly structured plugin directories with manifest.json,
directory structure, and optional test scaffolding.
"""

import os
import json
from typing import Optional


class ScaffoldGenerator:
    """Generates new plugin skeletons with proper structure."""

    DEFAULT_MANIFEST = {
        "name": "",
        "version": "0.1.0",
        "description": "",
        "author": "",
        "entry_point": "main.py",
        "tags": [],
    }

    def __init__(self):
        self._templates = {}
        self._register_defaults()

    def _register_defaults(self):
        """Register default templates."""
        self._templates["basic"] = self._basic_template

    def generate(self, plugin_name: str, output_dir: str,
                 template: str = "basic", **manifest_fields) -> str:
        """Generate a new plugin scaffold.

        Args:
            plugin_name: Name of the plugin
            output_dir: Directory to create the plugin in
            template: Template name (default: "basic")
            **manifest_fields: Additional manifest fields

        Returns:
            Path to the generated manifest.json
        """
        plugin_dir = os.path.join(output_dir, plugin_name)
        os.makedirs(plugin_dir, exist_ok=True)

        # Generate manifest
        manifest = dict(self.DEFAULT_MANIFEST)
        manifest["name"] = plugin_name
        manifest.update(manifest_fields)

        manifest_path = os.path.join(plugin_dir, "manifest.json")
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

        # Generate directory structure
        self._create_structure(plugin_dir, template)

        return manifest_path

    def _create_structure(self, plugin_dir: str, template: str):
        """Create directory structure based on template."""
        templates = {
            "basic": ["main.py"],
            "with_tests": ["main.py", "tests/test_main.py"],
            "with_config": ["main.py", "config.json"],
            "full": ["main.py", "tests/test_main.py", "config.json", "README.md", "LICENSE"],
        }

        files = templates.get(template, templates["basic"])
        for file_rel in files:
            file_path = os.path.join(plugin_dir, file_rel)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            if not os.path.exists(file_path):
                if file_rel.endswith(".py"):
                    with open(file_path, "w") as f:
                        f.write(f'"""{template} plugin."""\n\n')
                elif file_rel == "config.json":
                    with open(file_path, "w") as f:
                        json.dump({}, f)
                elif file_rel == "README.md":
                    with open(file_path, "w") as f:
                        f.write(f"# {plugin_name}\n\n")
                elif file_rel == "LICENSE":
                    with open(file_path, "w") as f:
                        f.write("MIT License\n")

    def _basic_template(self, plugin_dir: str):
        """Basic template: just main.py and manifest."""
        pass  # Handled by _create_structure

    def validate_scaffold(self, plugin_dir: str) -> dict:
        """Validate a generated scaffold.

        Returns dict with validation results.
        """
        result = {
            "valid": True,
            "issues": [],
            "warnings": [],
        }

        # Check manifest
        manifest_path = os.path.join(plugin_dir, "manifest.json")
        if not os.path.exists(manifest_path):
            result["valid"] = False
            result["issues"].append("Missing manifest.json")
            return result

        try:
            with open(manifest_path, "r") as f:
                manifest = json.load(f)

            # Check required fields
            for field in ["name", "version", "description", "author"]:
                if field not in manifest:
                    result["issues"].append(f"Missing manifest field: {field}")
                elif not str(manifest[field]).strip():
                    result["warnings"].append(f"Empty manifest field: {field}")

        except json.JSONDecodeError as e:
            result["valid"] = False
            result["issues"].append(f"Invalid manifest JSON: {e}")

        return result
