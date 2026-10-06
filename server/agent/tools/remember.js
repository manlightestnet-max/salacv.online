import { params } from './base.js';
import { forget, remember } from '../memory.js';

// Retenir une préférence durable de l'utilisateur (en base). Seulement s'il le demande ou l'exprime clairement.
export const rememberTool = {
  name: 'remember',
  description:
    "Retient une préférence durable de l'utilisateur, pour toutes ses prochaines conversations (ex. clé « dates », valeur « mois et année »). " +
    'Seulement quand il exprime une préférence ou demande de la retenir ; jamais une donnée du CV (elle y est déjà). Ne modifie pas le CV.',
  parameters: params(
    {
      key: { type: 'string', description: 'Nom court de la préférence (ex. « ton », « secteur visé »)' },
      value: { type: 'string', description: 'La préférence, en une phrase courte' },
    },
    ['key', 'value'],
  ),
  async run(run, { key, value }) {
    const r = await remember(run.username, key, value);
    if (r.ok) run.memory = [{ key, value }, ...(run.memory ?? []).filter((m) => m.key !== key)];
    return r;
  },
};

export const forgetTool = {
  name: 'forget',
  description: "Oublie une préférence retenue, quand l'utilisateur le demande. Ne modifie pas le CV.",
  parameters: params({ key: { type: 'string', description: 'Nom de la préférence à oublier' } }, ['key']),
  async run(run, { key }) {
    const r = await forget(run.username, key);
    if (r.ok) run.memory = (run.memory ?? []).filter((m) => m.key !== key);
    return r;
  },
};
