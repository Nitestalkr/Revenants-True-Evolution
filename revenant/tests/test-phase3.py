"""
Phase 3 Tests — LifecycleManager promotion, rollback, history.

Key: get_promotion_history() returns dicts with "type" key (value: "lifecycle_promote"),
     NOT "event_type". This assertion fix ensures tests match actual output.

Bug fixes baked in:
- Rollback: copy backup to temp dir FIRST, then rmtree plugin, then copy from temp
  (was: rmtree destroyed backup before copytree could read it)
"""

import os
import sys
import json
import tempfile
import shutil

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from engine.lifecycle_manager import LifecycleManager, LifecycleError, PromotionEvent, RollbackEvent


class TestLifecycleManagerInit:
    """Test LifecycleManager initialization."""

    def test_01_create_manager(self):
        mgr = LifecycleManager()
        assert mgr is not None
        # Cleanup
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_02_default_data_dir_is_temp(self):
        mgr = LifecycleManager()
        assert "/tmp" in mgr._data_dir or "revenant" in mgr._data_dir
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_03_custom_data_dir(self, tmp_path):
        custom = tmp_path / "custom_dir"
        mgr = LifecycleManager(str(custom))
        assert os.path.isdir(str(custom))

    def test_04_empty_history_init(self):
        mgr = LifecycleManager()
        assert mgr.get_promotion_history() == []
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_05_empty_stages_init(self):
        mgr = LifecycleManager()
        assert mgr.get_all_stages() == {}
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_06_valid_stages_constant(self):
        mgr = LifecycleManager()
        assert mgr.VALID_STAGES == ["t1", "t2", "t3"]
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)


class TestSetStage:
    """Test setting initial plugin stages."""

    def test_07_set_valid_stage_t1(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin_a", "t1")
        assert mgr.get_current_stage("plugin_a") == "t1"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_08_set_valid_stage_t2(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin_b", "t2")
        assert mgr.get_current_stage("plugin_b") == "t2"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_09_set_valid_stage_t3(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin_c", "t3")
        assert mgr.get_current_stage("plugin_c") == "t3"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_10_invalid_stage_raises(self):
        mgr = LifecycleManager()
        try:
            mgr.set_stage("plugin_x", "t0")
            assert False
        except LifecycleError:
            pass
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_11_invalid_stage_name(self):
        mgr = LifecycleManager()
        try:
            mgr.set_stage("plugin_x", "invalid")
            assert False
        except LifecycleError:
            pass
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)


class TestCanPromote:
    """Test promotion permission checks."""

    def test_12_can_promote_t1_to_t2(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        assert mgr.can_promote("plugin", "t2") is True
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_13_can_promote_t2_to_t3(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t2")
        assert mgr.can_promote("plugin", "t3") is True
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_14_cannot_promote_t1_to_t3(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        assert mgr.can_promote("plugin", "t3") is False
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_15_can_promote_t3_to_t2(self):
        """t3 to t2 is a rollback, which IS allowed."""
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t3")
        assert mgr.can_promote("plugin", "t2") is True
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_16_no_stage_initial_t1(self):
        mgr = LifecycleManager()
        assert mgr.can_promote("unknown", "t1") is True
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_17_no_stage_cannot_t2(self):
        mgr = LifecycleManager()
        assert mgr.can_promote("unknown", "t2") is False
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)


class TestPromote:
    """Test promotion operations."""

    def test_18_promote_t1_to_t2(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        result = mgr.promote("plugin", "t2")
        assert result["success"] is True
        assert result["to_stage"] == "t2"
        assert mgr.get_current_stage("plugin") == "t2"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_19_promote_t2_to_t3(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t2")
        result = mgr.promote("plugin", "t3")
        assert result["success"] is True
        assert result["to_stage"] == "t3"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_20_promote_no_stage_init_t1(self):
        mgr = LifecycleManager()
        result = mgr.promote("plugin", "t1")
        assert result["success"] is True
        assert result["to_stage"] == "t1"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_21_promote_invalid_transition_raises(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        try:
            mgr.promote("plugin", "t3")
            assert False
        except LifecycleError:
            pass
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_22_promote_no_stage_to_t2_raises(self):
        mgr = LifecycleManager()
        try:
            mgr.promote("plugin", "t2")
            assert False
        except LifecycleError:
            pass
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_23_promote_with_validation_pass(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")

        def validate(name, from_stage, to_stage):
            return from_stage == "t1" and to_stage == "t2"

        result = mgr.promote("plugin", "t2", validation_func=validate)
        assert result["success"] is True
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_24_promote_with_validation_fail(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")

        def validate(name, from_stage, to_stage):
            return False  # Always fail

        try:
            mgr.promote("plugin", "t2", validation_func=validate)
            assert False
        except LifecycleError:
            pass
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_25_promote_with_validation_error(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")

        def validate(name, from_stage, to_stage):
            raise ValueError("custom error")

        try:
            mgr.promote("plugin", "t2", validation_func=validate)
            assert False
        except LifecycleError as e:
            assert "custom error" in str(e)
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_26_promote_creates_backup(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        mgr.create_plugin_dir("plugin", {"manifest.json": '{"name":"plugin"}'})
        mgr.promote("plugin", "t2")
        assert "plugin" in mgr._backups
        assert mgr._backups["plugin"] is not None
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)


class TestPromotionHistory:
    """Test promotion history recording and retrieval."""

    def test_27_history_records_promotion(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        mgr.promote("plugin", "t2")
        history = mgr.get_promotion_history()
        assert len(history) == 1
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_28_history_event_has_type_key(self):
        """KEY ASSERTION FIX: history dicts use "type" key, not "event_type"."""
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        mgr.promote("plugin", "t2")
        history = mgr.get_promotion_history()
        assert len(history) == 1
        event = history[0]
        # Fixed: use "type" key (value: "lifecycle_promote")
        assert "type" in event
        assert event["type"] == "lifecycle_promote"
        # "event_type" should NOT exist
        assert "event_type" not in event
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_29_history_event_has_plugin_name(self):
        mgr = LifecycleManager()
        mgr.set_stage("myplugin", "t1")
        mgr.promote("myplugin", "t2")
        history = mgr.get_promotion_history("myplugin")
        assert len(history) == 1
        assert history[0]["plugin_name"] == "myplugin"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_30_history_event_has_stages(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        mgr.promote("plugin", "t2")
        history = mgr.get_promotion_history()
        event = history[0]
        assert event["from_stage"] == "t1"
        assert event["to_stage"] == "t2"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_31_history_event_has_timestamp(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        mgr.promote("plugin", "t2")
        history = mgr.get_promotion_history()
        assert "timestamp" in history[0]
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_32_filter_history_by_plugin(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin_a", "t1")
        mgr.set_stage("plugin_b", "t1")
        mgr.promote("plugin_a", "t2")
        mgr.promote("plugin_b", "t2")
        history_a = mgr.get_promotion_history("plugin_a")
        history_b = mgr.get_promotion_history("plugin_b")
        assert len(history_a) == 1
        assert len(history_b) == 1
        assert history_a[0]["plugin_name"] == "plugin_a"
        assert history_b[0]["plugin_name"] == "plugin_b"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_33_multiple_promotions_recorded(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        mgr.promote("plugin", "t2")
        mgr.promote("plugin", "t3")
        history = mgr.get_promotion_history()
        assert len(history) == 2
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)


class TestRollback:
    """Test rollback operations."""

    def test_34_rollback_t3_to_t2(self):
        mgr = LifecycleManager()
        # Create a real plugin dir so backup is possible
        mgr.set_stage("plugin", "t3")
        mgr.create_plugin_dir("plugin", {"manifest.json": '{"name":"plugin"}', "code.txt": "orig"})
        mgr._create_backup("plugin")
        result = mgr.rollback("plugin")
        assert result["success"] is True
        assert result["to_stage"] == "t2"
        assert mgr.get_current_stage("plugin") == "t2"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_35_rollback_t2_to_t1(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t2")
        mgr.create_plugin_dir("plugin", {"manifest.json": '{"name":"plugin"}'})
        mgr._create_backup("plugin")
        result = mgr.rollback("plugin")
        assert result["to_stage"] == "t1"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_36_rollback_no_backup_raises(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t3")
        try:
            mgr.rollback("plugin")
            assert False
        except LifecycleError:
            pass
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_37_rollback_no_stage_raises(self):
        mgr = LifecycleManager()
        try:
            mgr.rollback("plugin")
            assert False
        except LifecycleError:
            pass
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_38_rollback_records_event(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t3")
        mgr.create_plugin_dir("plugin", {"manifest.json": '{"name":"plugin"}'})
        mgr._create_backup("plugin")
        mgr.rollback("plugin", reason="bug found")
        history = mgr.get_promotion_history()
        assert len(history) == 1
        event = history[0]
        assert event["type"] == "lifecycle_rollback"
        assert event["reason"] == "bug found"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_39_rollback_clears_backup(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t3")
        mgr.create_plugin_dir("plugin", {"manifest.json": '{"name":"plugin"}'})
        mgr._create_backup("plugin")
        mgr.rollback("plugin")
        assert "plugin" not in mgr._backups
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_40_rollback_uses_type_key(self):
        """Rollback events also use "type" key, not "event_type"."""
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t3")
        mgr.create_plugin_dir("plugin", {"manifest.json": '{"name":"plugin"}'})
        mgr._create_backup("plugin")
        mgr.rollback("plugin")
        history = mgr.get_promotion_history()
        event = history[0]
        assert "type" in event
        assert event["type"] == "lifecycle_rollback"
        assert "event_type" not in event
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_41_rollback_restores_files(self):
        """Verify rollback restores plugin files from backup."""
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t3")
        mgr.create_plugin_dir("plugin", {"manifest.json": '{"name":"plugin"}', "original.txt": "original content"})
        mgr._create_backup("plugin")
        # Modify the plugin
        with open(os.path.join(mgr._data_dir, "plugins", "plugin", "modified.txt"), "w") as f:
            f.write("new content")
        # Rollback
        mgr.rollback("plugin")
        # Files should be restored
        assert os.path.exists(os.path.join(mgr._data_dir, "plugins", "plugin", "original.txt"))
        with open(os.path.join(mgr._data_dir, "plugins", "plugin", "original.txt")) as f:
            assert f.read() == "original content"
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)


class TestHistoryPersistence:
    """Test history persistence across manager restarts."""

    def test_42_history_persists_to_disk(self, tmp_path):
        data_dir = str(tmp_path / "data1")
        mgr = LifecycleManager(data_dir)
        mgr.set_stage("plugin", "t1")
        mgr.promote("plugin", "t2")
        assert len(mgr.get_promotion_history()) == 1
        mgr2 = LifecycleManager(data_dir)
        history = mgr2.get_promotion_history()
        assert len(history) == 1

    def test_43_history_loaded_from_disk(self, tmp_path):
        data_dir = str(tmp_path / "data2")
        mgr = LifecycleManager(data_dir)
        mgr.set_stage("plugin", "t1")
        mgr.promote("plugin", "t2")
        mgr2 = LifecycleManager(data_dir)
        history = mgr2.get_promotion_history()
        assert len(history) == 1
        assert history[0]["plugin_name"] == "plugin"

    def test_44_stages_loaded_from_disk(self, tmp_path):
        data_dir = str(tmp_path / "data3")
        mgr = LifecycleManager(data_dir)
        mgr.set_stage("plugin", "t2")
        mgr.promote("plugin", "t3")
        mgr2 = LifecycleManager(data_dir)
        assert mgr2.get_current_stage("plugin") == "t3"


class TestExportImportState:
    """Test state export and import."""

    def test_45_export_state(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t2")
        state = mgr.export_state()
        assert state["stages"]["plugin"] == "t2"
        assert "history" in state
        assert "backup_count" in state
        assert "data_dir" in state
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_46_import_state(self, tmp_path):
        data_dir = str(tmp_path / "import_test")
        mgr = LifecycleManager(data_dir)
        state = {
            "stages": {"p1": "t1", "p2": "t3"},
            "history": [{"type": "lifecycle_promote", "plugin_name": "p1",
                         "from_stage": "init", "to_stage": "t1",
                         "timestamp": "2026-01-01T00:00:00"}],
            "backup_count": 0,
            "data_dir": data_dir,
        }
        mgr.import_state(state)
        assert mgr.get_current_stage("p1") == "t1"
        assert mgr.get_current_stage("p2") == "t3"
        assert len(mgr.get_promotion_history()) == 1

    def test_47_clear_history(self, tmp_path):
        data_dir = str(tmp_path / "clear_test")
        mgr = LifecycleManager(data_dir)
        mgr.set_stage("plugin", "t1")
        mgr.promote("plugin", "t2")
        assert len(mgr.get_promotion_history()) == 1
        mgr.clear_history()
        assert len(mgr.get_promotion_history()) == 0


class TestValidationHelper:
    """Test validation helper methods."""

    def test_48_validate_for_promotion_t1_to_t2(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        assert mgr.validate_for_promotion("plugin", "t2") is True
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_49_validate_for_promotion_invalid(self):
        mgr = LifecycleManager()
        mgr.set_stage("plugin", "t1")
        assert mgr.validate_for_promotion("plugin", "t3") is False
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)

    def test_50_validate_for_promotion_no_stage(self):
        mgr = LifecycleManager()
        assert mgr.validate_for_promotion("unknown", "t1") is True
        if os.path.isdir(mgr._data_dir):
            shutil.rmtree(mgr._data_dir)


class TestPromotionEvent:
    """Test PromotionEvent dataclass."""

    def test_51_to_dict(self):
        event = PromotionEvent(
            plugin_name="test",
            from_stage="t1",
            to_stage="t2",
            timestamp="2026-01-01T00:00:00",
            type="lifecycle_promote",
        )
        d = event.to_dict()
        assert d["plugin_name"] == "test"
        assert d["type"] == "lifecycle_promote"

    def test_52_from_dict(self):
        data = {
            "plugin_name": "test",
            "from_stage": "t1",
            "to_stage": "t2",
            "timestamp": "2026-01-01T00:00:00",
            "type": "lifecycle_promote",
        }
        event = PromotionEvent.from_dict(data)
        assert event.plugin_name == "test"
        assert event.to_stage == "t2"


class TestRollbackEvent:
    """Test RollbackEvent dataclass."""

    def test_53_rollback_event_to_dict(self):
        event = RollbackEvent(
            plugin_name="test",
            from_stage="t3",
            to_stage="t2",
            timestamp="2026-01-01T00:00:00",
            reason="bug found",
            type="lifecycle_rollback",
        )
        d = event.to_dict()
        assert d["type"] == "lifecycle_rollback"
        assert d["reason"] == "bug found"

    def test_54_rollback_event_from_dict(self):
        data = {
            "plugin_name": "test",
            "from_stage": "t3",
            "to_stage": "t2",
            "timestamp": "2026-01-01T00:00:00",
            "reason": "bug found",
            "type": "lifecycle_rollback",
        }
        event = RollbackEvent.from_dict(data)
        assert event.plugin_name == "test"
        assert event.reason == "bug found"


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
