import unittest

import research

XML = b"""<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>111</PMID><Article>
<Journal><JournalIssue><PubDate><Year>2026</Year><Month>Sep</Month></PubDate></JournalIssue><ISOAbbreviation>J Test</ISOAbbreviation></Journal>
<ArticleTitle>Aripiprazole <i>versus</i> placebo.</ArticleTitle>
<Abstract><AbstractText Label="RESULTS">It worked.</AbstractText><AbstractText>Well.</AbstractText></Abstract>
<PublicationTypeList><PublicationType>Meta-Analysis</PublicationType></PublicationTypeList>
<ArticleDate><Year>2026</Year><Month>05</Month><Day>20</Day></ArticleDate>
</Article></MedlineCitation></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID>222</PMID><Article>
<Journal><JournalIssue><PubDate><Year>2025</Year><Month>Nov</Month></PubDate></JournalIssue><Title>Other Journal</Title></Journal>
<ArticleTitle>No abstract here.</ArticleTitle>
<PublicationTypeList><PublicationType>Randomized Controlled Trial</PublicationType></PublicationTypeList>
</Article></MedlineCitation></PubmedArticle></PubmedArticleSet>"""


class ResearchTest(unittest.TestCase):
    def test_parse_keeps_papers_with_abstracts(self):
        [paper] = research.parse_articles(XML)
        self.assertEqual(paper["pmid"], "111")
        self.assertEqual(paper["title"], "Aripiprazole versus placebo.")
        self.assertEqual(paper["journal"], "J Test")
        self.assertEqual(paper["published_on"], "2026-05-20")  # e-publication date wins
        self.assertEqual(paper["abstract"], "It worked. Well.")

    def test_cards_only_for_real_papers(self):
        papers = research.parse_articles(XML)
        cards = research.build_cards("ARIPIPRAZOLE", [
            {"pmid": "999", "study": "x", "finding": "Invented", "say": "x", "caution": None},
            {"pmid": "111", "study": "Meta-analysis", "finding": " Worked. ", "say": "Say this", "caution": ""},
            {"pmid": "111", "study": "dup", "finding": "dup", "say": "dup", "caution": None},
        ], papers)
        self.assertEqual(len(cards), 1)
        self.assertEqual((cards[0]["pmid"], cards[0]["finding"], cards[0]["caution"], cards[0]["rank"]),
                         ("111", "Worked.", None, 0))
        self.assertEqual(cards[0]["title"], "Aripiprazole versus placebo.")


if __name__ == "__main__":
    unittest.main()
