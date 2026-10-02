"""Tests de l'agent avec un modèle simulé : aucun réseau, aucune clé."""
import json
import os
import unittest
from unittest import mock

from agent import state as cv
from agent.llm.providers import ProviderManager
from agent.loop import announces_future_work
from agent.run import handle
from agent.secrets import redact
from agent.server import RateLimiter


def call(tool, **args):
    return {"id": f"c-{tool}", "type": "function", "function": {"name": tool, "arguments": json.dumps(args, ensure_ascii=False)}}


def scripted(*turns):
    """Modèle simulé : renvoie les tours prévus dans l'ordre et garde les messages reçus."""
    seen = []

    def model(messages, specs):
        seen.append(json.loads(json.dumps(messages)))
        calls = turns[len(seen) - 1]
        return {"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": calls}}]}

    model.seen = seen
    return model


class AgentTest(unittest.TestCase):
    def test_remplit_le_cv_depuis_un_message_en_vrac(self):
        model = scripted(
            [
                call("set_identity", name="Rais Wasongolua", title="Juriste", phones=["+243 82 22 14 440"], email="rais@gmail.com"),
                call("add_entry", section="education", period="2016 — 2017", title="Licence en droit privé et judiciaire", org="Université Protestante au Congo"),
                call("add_entry", section="experiences", period="2017", title="Secrétaire juridique", org="Cabinet Kahisha", details=["Gestion des courriers", "Suivi des dossiers"]),
                call("edit_list", section="skills", items=["Rédaction juridique", "Microsoft Office"]),
                call("set_languages", languages=[{"name": "Français", "level": "Courant"}, {"name": "Lingala", "level": "Natif"}]),
            ],
            [call("final_answer", text="J'ai rempli ton CV. Ajoute un profil professionnel ?")],
        )
        out = handle({"state": {}, "message": "je suis rais wasongolua juriste ..."}, call_model=model)
        self.assertTrue(out["ok"])
        s = out["state"]
        self.assertEqual(s["profile"]["name"], "Rais Wasongolua")
        self.assertEqual(s["profile"]["phones"], ["+243 82 22 14 440"])
        self.assertEqual(s["education"][0]["org"], "Université Protestante au Congo")
        self.assertEqual(s["experiences"][0]["details"], "Gestion des courriers\nSuivi des dossiers")
        self.assertEqual(s["skills"], ["Rédaction juridique", "Microsoft Office"])
        self.assertEqual([l["name"] for l in s["languages"]], ["Français", "Lingala"])
        self.assertIn("identité", out["changes"])
        self.assertEqual(out["reply"], "J'ai rempli ton CV. Ajoute un profil professionnel ?")

    def test_modification_precise_garde_le_reste(self):
        start = {"profile": {"name": "A"}, "experiences": [{"period": "2025", "title": "Stagiaire", "org": "Vodacom", "details": "Câblage"}], "skills": ["Excel"]}
        model = scripted([call("update_entry", section="experiences", index=0, details=["Installé et câblé des baies réseau"])], [call("final_answer", text="C'est reformulé.")])
        out = handle({"state": start, "message": "reformule mon stage"}, call_model=model)
        exp = out["state"]["experiences"][0]
        self.assertEqual((exp["title"], exp["org"], exp["details"]), ("Stagiaire", "Vodacom", "Installé et câblé des baies réseau"))
        self.assertEqual(out["state"]["skills"], ["Excel"])
        # Le modèle voit le CV actuel avec les index à utiliser.
        self.assertIn('"index": 0', model.seen[0][-1]["content"])

    def test_final_answer_qui_promet_est_refuse_une_fois(self):
        model = scripted(
            [call("final_answer", text="Je vais remplir ton CV, un instant.")],
            [call("set_summary", text="Juriste formé à l'UPC."), call("final_answer", text="Profil ajouté.")],
        )
        out = handle({"state": {}, "message": "fais mon profil"}, call_model=model)
        self.assertEqual(out["reply"], "Profil ajouté.")
        self.assertEqual(out["state"]["profile"]["summary"], "Juriste formé à l'UPC.")
        # set_summary était dans le même tour que final_answer : exécuté quand même.
        self.assertTrue(announces_future_work("je vais ajouter ça"))
        self.assertFalse(announces_future_work("J'ai ajouté Excel."))

    def test_erreurs_d_outil_renvoyees_au_modele_sans_planter(self):
        model = scripted([call("update_entry", section="education", index=7, title="X"), call("outil_invente")], [call("final_answer", text="ok")])
        out = handle({"state": {}, "message": "x"}, call_model=model)
        tool_results = [json.loads(m["content"]) for m in model.seen[1] if m["role"] == "tool"]
        self.assertIn("index invalide", tool_results[0]["error"])
        self.assertIn("inconnu", tool_results[1]["error"])
        self.assertTrue(out["ok"])

    def test_bornes_sur_les_donnees(self):
        s = cv.normalize({"profile": {"name": "x" * 500, "phones": ["1", "2", "3", "4", "1"]}, "skills": "a\nA\nb", "education": "pas une liste"})
        self.assertEqual(len(s["profile"]["name"]), cv.LIMITS["name"])
        self.assertEqual(s["profile"]["phones"], ["1", "2", "3"])
        self.assertEqual(s["skills"], ["a", "b"])
        self.assertEqual(s["education"], [])

    def test_message_vide(self):
        out = handle({"state": {}, "message": "  "}, call_model=scripted())
        self.assertEqual((out["ok"], out["status"]), (False, 400))

    def test_cles_lues_dans_l_environnement_uniquement(self):
        with mock.patch.dict(os.environ, {"OLLAMA_API_KEY": "cle-de-test-123456"}, clear=False):
            for name in ("GEMINI_API_KEY", "GEMINI_API_KEYS", "GROQ_API_KEY", "GROQ_API_KEYS", "OLLAMA_API_KEYS"):
                os.environ.pop(name, None)
            manager = ProviderManager.load()
        self.assertEqual([p.name for p in manager.providers], ["ollama"])
        self.assertEqual(manager.providers[0].api_keys[0].key, "cle-de-test-123456")
        with open(os.path.join(os.path.dirname(__file__), "..", "providers.json"), encoding="utf-8") as f:
            self.assertNotIn("apiKey", f.read())
        self.assertEqual(redact("erreur avec cle-de-test-123456", ["cle-de-test-123456"]), "erreur avec ***")

    def test_sans_cle_reponse_propre(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            out = handle({"state": {}, "message": "salut"})
        self.assertEqual((out["ok"], out["status"]), (False, 503))

    def test_cle_epuisee_partagee_sans_ecrire_la_cle(self):
        import tempfile
        from agent.llm import providers
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(providers, "STATUS_PATH", os.path.join(tmp, "k.json")), \
                mock.patch.dict(os.environ, {"OLLAMA_API_KEYS": "cle-a-1234567890,cle-b-1234567890"}):
            first = ProviderManager.load()
            first.providers[0].api_keys[0].mark_exhausted()
            second = ProviderManager.load()  # autre requête / autre process
            self.assertEqual(second.providers[0].next_key().key, "cle-b-1234567890")
            with open(providers.STATUS_PATH, encoding="utf-8") as f:
                self.assertNotIn("cle-a", f.read())

    def test_limite_de_debit(self):
        limiter = RateLimiter(2)
        self.assertEqual([limiter.allow("u1") for _ in range(3)], [True, True, False])
        self.assertTrue(limiter.allow("u2"))


if __name__ == "__main__":
    unittest.main()
