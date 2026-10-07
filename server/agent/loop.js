// Boucle de l'agent : le modèle appelle des outils jusqu'à final_answer (reprise de l'agent Ivy).

export const clean = (text) =>
  String(text ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<\/?think>/g, '')
    .trim();

// final_answer qui annonce un travail au lieu de le faire (« je vais remplir ton CV »). Certains
// modèles (gemma…) le prennent pour un message d'attente : refusé une fois, avec l'explication.
const PROMISE =
  /\b(?:je\s+(?:vais|m'en\s+vais)\s+(?:te\s+|t'|le\s+|la\s+|les\s+)?(?:faire|cr[ée]er|remplir|ajouter|modifier|mettre|pr[ée]parer|r[ée]diger|corriger|reformuler|compl[ée]ter|m'en\s+occuper|m'occuper)|je\s+(?:m'en\s+occupe|pr[ée]pare|m'y\s+mets)|un\s+instant|une\s+seconde|patiente[zr]?|c'est\s+en\s+cours)/i;

export const announcesFutureWork = (text) => PROMISE.test(clean(text));

const REFUSED =
  "final_answer REFUSÉ : ton texte annonce un travail pas encore fait. Fais-le MAINTENANT avec tes outils, puis appelle final_answer avec le résultat.";

function args(call) {
  try {
    const parsed = JSON.parse(call.function.arguments || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function callTool(run, tools, name, input) {
  const tool = tools.get(name);
  if (!tool) return { error: `Outil inconnu : ${name}` };
  try {
    return await tool.run(run, input);
  } catch (err) {
    // un outil qui plante ne doit pas faire tomber la requête
    return { error: `Échec de ${name} : ${err.message}` };
  }
}

// Exécute la boucle ; modifie run.state et renvoie le texte final pour l'étudiant.
// overBudget() : vrai quand la demande a dépensé son plafond de tokens (réglé dans l'admin) ; on s'arrête proprement,
// ce qui est déjà fait est gardé.
export const BUDGET_STOP = "J'ai atteint la limite de cette demande : ce que j'ai déjà fait est gardé. Redemande-moi la suite.";
export async function runLoop(run, messages, specs, tools, callModel, maxIterations = 8, overBudget = () => false) {
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (iteration > 1 && overBudget()) return BUDGET_STOP;
    const choice = (await callModel(messages, specs)).choices[0].message;
    const calls = choice.tool_calls ?? [];
    const content = clean(choice.content);

    const final = calls.find((c) => c.function.name === 'final_answer');
    if (final) {
      const text = args(final).text ?? '';
      if (!(announcesFutureWork(text) && !run.flags.promiseRefused && iteration < maxIterations)) {
        // Outils demandés dans le même tour que final_answer : exécutés avant de conclure,
        // sinon le CV ne contiendrait pas ce que la réponse annonce.
        for (const call of calls) if (call !== final && call.function.name !== 'final_answer') await callTool(run, tools, call.function.name, args(call));
        return clean(text);
      }
      run.flags.promiseRefused = true;
    }

    if (!calls.length) {
      if (content) return content;
      messages.push({ role: 'assistant', content: '' }, { role: 'user', content: 'Rappel : modifie le CV avec tes outils, puis appelle final_answer.' });
      continue;
    }

    messages.push({ role: 'assistant', content: choice.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const name = call.function.name;
      const result = name === 'final_answer' ? { error: REFUSED } : await callTool(run, tools, name, args(call));
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return "Je n'ai pas réussi à tout terminer. Vérifie ton CV et redemande-moi ce qui manque.";
}
