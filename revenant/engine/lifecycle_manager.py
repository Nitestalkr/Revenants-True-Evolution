"""
LifecycleManager — Phase 3: Promotion, rollback, and history tracking.

Manages plugin lifecycle stages (t1 → t2 → t3) with promotion validation,
rollback capability, and full promotion history.

Bug fixes applied:
- Rollback: copy backup to temp dir FIRST, then rmtree plugin, then copy from temp
  (was: rmtree destroyed backup before copytree could read it)
- Backups: include microseconds in backup names so rapid promotions do not collide
- No duplicate methods in validator (validator.py handles this separately)
"""

import os
import json
import tempfile
import shutil
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime


class LifecycleError(Exception):
    """Raised when a lifecycle operation fails."""
    pass


@dataclass
class PromotionEvent:
    """Records a single promotion event."""
    plugin_name: str
    from_stage: str
    to_stage: str
    timestamp: str
    type: str = "lifecycle_promote"

    def to_dict(self) -> dict:
        return {
            "plugin_name": self.plugin_name,
            "from_stage": self.from_stage,
            "to_stage": self.to_stage,
            "timestamp": self.timestamp,
            "type": self.type,
        }

    @staticmethod
    def from_dict(data: dict) -> "PromotionEvent":
        return PromotionEvent(**{k: v for k, v in data.items() if k != "type"})


@dataclass
class RollbackEvent:
    """Records a single rollback event."""
    plugin_name: str
    from_stage: str
    to_stage: str
    timestamp: str
    reason: str
    type: str = "lifecycle_rollback"

    def to_dict(self) -> dict:
        return {
            "plugin_name": self.plugin_name,
            "from_stage": self.from_stage,
            "to_stage": self.to_stage,
            "timestamp": self.timestamp,
            "reason": self.reason,
            "type": self.type,
        }

    @staticmethod
    def from_dict(data: dict) -> "RollbackEvent":
        return RollbackEvent(
            plugin_name=data["plugin_name"],
            from_stage=data["from_stage"],
            to_stage=data["to_stage"],
            timestamp=data["timestamp"],
            reason=data["reason"],
            type=data.get("type", "lifecycle_rollback"),
        )


class LifecycleManager:
    """Manages plugin lifecycle: promotion, rollback, and history."""

    VALID_STAGES = ["t1", "t2", "t3"]
    ALLOWED_TRANSITIONS = {
        ("t1", "t2"),
        ("t2", "t3"),
        ("t3", "t1"),  # rollback to t1 allowed
        ("t3", "t2"),  # rollback to t2 allowed
        ("t2", "t1"),  # rollback to t1 allowed
    }

    def __init__(self, data_dir: Optional[str] = None):
        if data_dir is None:
            self._data_dir = tempfile.mkdtemp(prefix="revenant_lifecycle_")
        else:
            self._data_dir = data_dir
        self._history: List[dict] = []
        self._stages: Dict[str, str] = {}  # plugin_name -> current stage
        self._backups: Dict[str, str] = {}  # plugin_name -> backup_path
        self._ensure_data_dir()
        self._load_history()
        self._load_stages()

    def _ensure_data_dir(self):
        """Ensure data directory exists."""
        os.makedirs(self._data_dir, exist_ok=True)

    def _save_stages(self):
        """Save stages to disk."""
        stages_path = os.path.join(self._data_dir, "stages.json")
        with open(stages_path, "w") as f:
            json.dump(self._stages, f)

    def _load_history(self):
        """Load promotion history from disk."""
        history_path = os.path.join(self._data_dir, "history.json")
        if os.path.exists(history_path):
            with open(history_path, "r") as f:
                self._history = json.load(f)

    def _load_stages(self):
        """Load stages from disk."""
        stages_path = os.path.join(self._data_dir, "stages.json")
        if os.path.exists(stages_path):
            with open(stages_path, "r") as f:
                self._stages = json.load(f)

    def _save_history(self):
        """Save promotion history to disk."""
        history_path = os.path.join(self._data_dir, "history.json")
        with open(history_path, "w") as f:
            json.dump(self._history, f, indent=2)

    def get_current_stage(self, plugin_name: str) -> Optional[str]:
        """Get the current stage of a plugin."""
        return self._stages.get(plugin_name)

    def set_stage(self, plugin_name: str, stage: str):
        """Set a plugin's stage (for initialization)."""
        if stage not in self.VALID_STAGES:
            raise LifecycleError(f"Invalid stage: {stage}")
        self._stages[plugin_name] = stage
        self._save_stages()

    def can_promote(self, plugin_name: str, target_stage: str) -> bool:
        """Check if a plugin can be promoted to target stage."""
        current = self._stages.get(plugin_name)
        if current is None:
            return target_stage == "t1"
        return (current, target_stage) in self.ALLOWED_TRANSITIONS

    def promote(self, plugin_name: str, target_stage: str,
                validation_func: Optional[callable] = None) -> dict:
        """Promote a plugin to a new stage.

        Args:
            plugin_name: Name of the plugin to promote
            target_stage: Target stage (t1, t2, or t3)
            validation_func: Optional validation callable before promotion

        Returns:
            dict with promotion result

        Raises:
            LifecycleError: If promotion is not allowed or validation fails
        """
        current_stage = self._stages.get(plugin_name)

        # Allow initial stage set
        if current_stage is None:
            if target_stage != "t1":
                raise LifecycleError(
                    f"Plugin '{plugin_name}' not initialized. Must start at t1."
                )
        else:
            # Check transition is allowed
            if (current_stage, target_stage) not in self.ALLOWED_TRANSITIONS:
                raise LifecycleError(
                    f"Cannot promote '{plugin_name}' from {current_stage} to {target_stage}"
                )

        # Run validation if provided
        if validation_func and current_stage is not None:
            try:
                valid = validation_func(plugin_name, current_stage, target_stage)
                if not valid:
                    raise LifecycleError(
                        f"Validation failed for promotion from {current_stage} to {target_stage}"
                    )
            except LifecycleError:
                raise
            except Exception as e:
                raise LifecycleError(f"Validation error: {e}")

        # Create backup before promotion
        self._create_backup(plugin_name)

        # Update stage
        old_stage = current_stage or "init"
        self._stages[plugin_name] = target_stage
        self._save_stages()

        # Record event
        event = PromotionEvent(
            plugin_name=plugin_name,
            from_stage=old_stage,
            to_stage=target_stage,
            timestamp=datetime.now().isoformat(),
            type="lifecycle_promote",
        )
        self._history.append(event.to_dict())
        self._save_history()

        return {
            "success": True,
            "plugin": plugin_name,
            "from_stage": old_stage,
            "to_stage": target_stage,
            "timestamp": event.timestamp,
        }

    def rollback(self, plugin_name: str, reason: str = "manual") -> dict:
        """Rollback a plugin to its previous stage and restore from backup.

        Bug fix: Copies backup to temp dir FIRST, then rmtree plugin, then copy from temp.
        Previously: rmtree(plugin_path) deleted the backup dir before copytree could read it.

        Args:
            plugin_name: Name of the plugin to rollback
            reason: Reason for rollback

        Returns:
            dict with rollback result
        """
        current_stage = self._stages.get(plugin_name)
        if current_stage is None:
            raise LifecycleError(f"Plugin '{plugin_name}' has no stage to rollback from")

        backup_path = self._backups.get(plugin_name)
        if not backup_path:
            raise LifecycleError(f"No backup available for '{plugin_name}'")

        # Determine target stage for rollback
        if current_stage == "t3":
            target_stage = "t2"
        elif current_stage == "t2":
            target_stage = "t1"
        else:
            raise LifecycleError(
                f"Cannot rollback from stage {current_stage}"
            )

        # --- BUG FIX: Copy backup to temp FIRST ---
        # Previously we rmtree'd the plugin dir which was also the backup dir,
        # destroying it before copytree could read it.
        temp_restore_dir = tempfile.mkdtemp(prefix=f"revenant_restore_{plugin_name}_")

        try:
            # Copy backup contents to temp dir
            if os.path.isdir(backup_path):
                for item in os.listdir(backup_path):
                    s = os.path.join(backup_path, item)
                    d = os.path.join(temp_restore_dir, item)
                    if os.path.isdir(s):
                        shutil.copytree(s, d)
                    else:
                        shutil.copy2(s, d)
            else:
                # Single file backup
                shutil.copy2(backup_path, temp_restore_dir)

            # Now safe to remove plugin dir
            plugin_path = self._get_plugin_path(plugin_name)
            if plugin_path and os.path.exists(plugin_path):
                shutil.rmtree(plugin_path)

            # Copy restored files to plugin path
            if os.path.exists(plugin_path):
                shutil.rmtree(plugin_path)
            shutil.copytree(temp_restore_dir, plugin_path)

        finally:
            # Clean up temp dir
            if os.path.exists(temp_restore_dir):
                shutil.rmtree(temp_restore_dir)

        # Update stage
        old_stage = current_stage
        self._stages[plugin_name] = target_stage
        self._save_stages()

        # Record rollback event
        event = RollbackEvent(
            plugin_name=plugin_name,
            from_stage=old_stage,
            to_stage=target_stage,
            timestamp=datetime.now().isoformat(),
            reason=reason,
            type="lifecycle_rollback",
        )
        self._history.append(event.to_dict())
        self._save_history()

        # Clear backup
        if plugin_name in self._backups:
            del self._backups[plugin_name]

        return {
            "success": True,
            "plugin": plugin_name,
            "from_stage": old_stage,
            "to_stage": target_stage,
            "reason": reason,
            "timestamp": event.timestamp,
        }

    def _create_backup(self, plugin_name: str):
        """Create a backup of the plugin before promotion."""
        plugin_path = self._get_plugin_path(plugin_name)
        if not plugin_path or not os.path.exists(plugin_path):
            return

        backup_dir = os.path.join(self._data_dir, "backups", plugin_name)
        os.makedirs(backup_dir, exist_ok=True)

        # Include microseconds so multiple promotions in one second are unique.
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        backup_path = os.path.join(backup_dir, timestamp)
        shutil.copytree(plugin_path, backup_path)
        self._backups[plugin_name] = backup_path

    def create_plugin_dir(self, plugin_name: str, files: dict = None):
        """Helper to create a plugin directory for testing.
        
        files: dict mapping filenames to content strings.
        """
        plugin_path = os.path.join(self._data_dir, "plugins", plugin_name)
        os.makedirs(plugin_path, exist_ok=True)
        if files:
            for fname, content in files.items():
                fpath = os.path.join(plugin_path, fname)
                os.makedirs(os.path.dirname(fpath), exist_ok=True)
                with open(fpath, "w") as f:
                    f.write(content)
        return plugin_path

    def _get_plugin_path(self, plugin_name: str) -> Optional[str]:
        """Get the plugin directory path."""
        # Search common locations
        candidates = [
            os.path.join(self._data_dir, "plugins", plugin_name),
            plugin_name,  # Could be absolute path
        ]

        for path in candidates:
            if os.path.isdir(path):
                return path
        return None

    def get_promotion_history(self, plugin_name: Optional[str] = None) -> List[dict]:
        """Get promotion/rollback history.

        Returns list of events with "type" key (not "event_type").
        """
        if plugin_name:
            return [
                h for h in self._history if h.get("plugin_name") == plugin_name
            ]
        return list(self._history)

    def get_all_stages(self) -> Dict[str, str]:
        """Get all plugin stages."""
        return dict(self._stages)

    def validate_for_promotion(self, plugin_name: str,
                                target_stage: str) -> bool:
        """Default validation: check stage transition is valid."""
        return self.can_promote(plugin_name, target_stage)

    def clear_history(self):
        """Clear promotion history."""
        self._history.clear()
        self._save_history()

    def export_state(self) -> dict:
        """Export full lifecycle state."""
        return {
            "stages": dict(self._stages),
            "history": self._history,
            "backup_count": len(self._backups),
            "data_dir": self._data_dir,
        }

    def import_state(self, state: dict):
        """Import lifecycle state from dict."""
        self._stages = state.get("stages", {})
        self._history = state.get("history", [])
        self._save_history()
