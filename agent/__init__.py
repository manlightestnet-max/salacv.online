"""Agent salacv : remplit et modifie le CV d'un étudiant à partir de ses messages.

Même architecture que l'agent Ivy (un outil = un fichier, boucle modèle ↔ outils
jusqu'à final_answer, rotation des clés API), réduite à ce dont un CV a besoin :
aucun accès au disque ni au shell, seulement des outils qui modifient le CV.
"""
