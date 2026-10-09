import time
import unittest

from mc_overlay import claude_running, detail_lines, is_stale, overlay_wanted, summary_line, top_pct, zone

STATUS = {
    'meter': {
        'ctxPct': 48,
        'fiveHour': {'pct': 57, 'resetsAt': '2026-10-09T05:00:00.000Z'},
        'weekly': {'pct': 19},
        'costUsd': 16.4,
        'at': 0,
    },
    'route': {'model': 'opus', 'effort': 'high'},
    'limited': None,
    'midnight': None,
    'god': None,
    'settings': {'agentCap': 3},
    'agents': [{'description': 'write tests', 'status': 'running'}, {'description': 'old', 'status': 'completed'}],
}


class OverlayLogic(unittest.TestCase):
    def test_zone_follows_the_mod(self):
        self.assertEqual(zone(59.9), 'ok')
        self.assertEqual(zone(60), 'watch')
        self.assertEqual(zone(80), 'warn')
        self.assertEqual(zone(90), 'high')
        self.assertEqual(zone(95), 'danger')

    def test_top_pct(self):
        self.assertEqual(top_pct(STATUS['meter']), 57)
        self.assertEqual(top_pct(None), 0)

    def test_summary_line_is_short(self):
        self.assertEqual(summary_line(STATUS), 'Context 48% · 5h 57% · Week 19% · 1 agent')

    def test_summary_without_readings(self):
        self.assertEqual(summary_line({}), 'Mission Control · waiting for Claude')

    def test_detail_lines(self):
        lines = detail_lines(STATUS)
        self.assertIn('Model  opus · high', lines)
        self.assertIn('• write tests', lines)
        self.assertNotIn('• old', lines)

    def test_midnight_and_god_show(self):
        s = dict(STATUS, midnight={'endsAt': (time.time() + 3600) * 1000}, god={'endsAt': (time.time() + 600) * 1000})
        text = '\n'.join(detail_lines(s))
        self.assertIn('🌙 Midnight', text)
        self.assertIn('⚡ God mode', text)

    def test_stale_status(self):
        self.assertTrue(is_stale(0.0, now=1000.0))
        self.assertFalse(is_stale(995.0, now=1000.0))


class ClaudeRunning(unittest.TestCase):
    def test_finds_the_claude_app(self):
        out = 'Image Name   PID\nClaude.exe     1234 Console 1\n'
        self.assertTrue(claude_running(out))

    def test_ignores_other_programs(self):
        self.assertFalse(claude_running('INFO: No tasks are running which match the specified criteria.'))
        self.assertFalse(claude_running('Notepad.exe 99 Console 1'))


class OverlaySwitch(unittest.TestCase):
    def test_off_closes_the_pill(self):
        self.assertFalse(overlay_wanted({'settings': {'overlay': False}}))

    def test_on_or_unknown_keeps_it(self):
        self.assertTrue(overlay_wanted({'settings': {'overlay': True}}))
        self.assertTrue(overlay_wanted({}))


if __name__ == '__main__':
    unittest.main()
