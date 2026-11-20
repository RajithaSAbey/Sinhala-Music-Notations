import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'transcribe'))
from swara import to_swara


class Swara(unittest.TestCase):
    def test_degrees_from_d(self):
        sa = 62  # D4
        self.assertEqual([to_swara(sa + o, sa) for o in (0, 2, 4, 5, 7, 9, 11)], list('SRGMPDN'))

    def test_octaves(self):
        sa = 62
        self.assertEqual(to_swara(sa + 12, sa), 'S+')
        self.assertEqual(to_swara(sa + 14, sa), 'R+')
        self.assertEqual(to_swara(sa - 1, sa), 'N.')
        self.assertEqual(to_swara(sa - 12, sa), 'S.')

    def test_other_semitones_are_not_guessed(self):
        self.assertIsNone(to_swara(63, 62))


if __name__ == '__main__':
    unittest.main()
