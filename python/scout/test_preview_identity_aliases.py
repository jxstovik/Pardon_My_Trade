import unittest

from weekly_scout import ALIASES, norm


class PreviewIdentityAliases(unittest.TestCase):
    def test_verified_espn_senior_suffixes_map_to_nflverse_names(self):
        # ESPN 3042519 / GSIS 00-0033293 and ESPN 4360248 / GSIS 00-0036970.
        for espn, nflverse in [('Aaron Jones Sr.', 'Aaron Jones'),
                               ('Kyle Pitts Sr.', 'Kyle Pitts')]:
            self.assertEqual(norm(ALIASES[espn]), norm(nflverse))

    def test_aliases_do_not_strip_suffixes_from_arbitrary_players(self):
        self.assertNotIn('Unknown Player Sr.', ALIASES)
        self.assertNotEqual(norm('Unknown Player Sr.'), norm('Unknown Player'))


if __name__ == '__main__':
    unittest.main()
