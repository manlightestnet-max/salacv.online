// Données des démonstrations de la landing (sans navigateur : testées dans test/showcase.test.js).
// L'exemple de l'app traduit (contenu seulement ; noms propres, contacts et dates inchangés) et le script de l'assistant.
// --- L'exemple traduit (contenu seulement ; noms propres, contacts et dates inchangés) ------------------------
export function translated(example, lang, t) {
  const [edu, exp, skills, langs, hobbies] = example.sections;
  return {
    ...example,
    lang,
    profile: { ...example.profile, title: t.title, summary: t.summary },
    sections: [
      { ...edu, title: t.edu, items: edu.items.map((it, i) => ({ ...it, ...t.eduItems[i] })) },
      { ...exp, title: t.exp, items: exp.items.map((it, i) => ({ ...it, ...t.expItems[i] })) },
      { ...skills, title: t.skills, items: t.skillItems },
      { ...langs, title: t.langs, items: langs.items.map((it, i) => ({ ...it, ...t.langItems[i] })) },
      { ...hobbies, title: t.hobbies, items: t.hobbyItems },
    ],
  };
}

export const EN = {
  title: 'Network and telecommunications technician',
  summary:
    'Network and telecommunications technician trained at ENSP Brazzaville, with hands-on experience in network installation, Cisco equipment configuration and telecom site maintenance.\nRigorous and autonomous, I am looking for an internship or a first job with an operator or a network integration company.',
  edu: 'Education & certifications',
  eduItems: [
    { title: 'Bachelor in networks and telecommunications', bullets: ['Routing and switching, IP addressing, VLAN, network security', 'Radio transmission, optical fibre, GSM and 4G systems'] },
    { title: 'Cisco CCNA certification (Introduction to Networks)', bullets: ['Router and switch configuration, network troubleshooting'] },
    { title: 'Technical baccalaureate, F series (electronics)' },
  ],
  exp: 'Professional experience',
  expItems: [
    { title: 'Network technician intern', period: 'June — Sept. 2025', bullets: ['Installation and cabling of network racks at client sites', 'Configuration of Cisco routers and switches', 'Optical fibre link testing and intervention reports', 'Support to BTS site maintenance teams'] },
    { title: 'Volunteer technician', org: 'ENSP computer club', bullets: ['Set up the Wi-Fi network of the computer room', 'Networking workshops for 60 students'] },
  ],
  skills: 'Skills & certifications',
  skillItems: ['LAN / WAN networks', 'Cisco routing and switching', 'Optical fibre (splicing, OTDR tests)', 'Structured cabling', 'Telecom site maintenance', 'Microsoft Office (Word, Excel, PowerPoint)', 'Technical English', 'Teamwork under pressure'],
  langs: 'Languages',
  langItems: [{ name: 'French', level: 'Fluent' }, { name: 'Lingala', level: 'Native' }, { name: 'English', level: 'Intermediate' }, { name: 'Kituba', level: 'Fluent' }],
  hobbies: 'Interests',
  hobbyItems: ['Football', 'Reading', 'Music', 'Community volunteering'],
};

export const PT = {
  title: 'Técnica de redes e telecomunicações',
  summary:
    'Técnica de redes e telecomunicações formada na ENSP de Brazzaville, com experiência prática em instalação de redes, configuração de equipamentos Cisco e manutenção de sites de telecomunicações.\nRigorosa e autónoma, procuro um estágio ou um primeiro emprego numa operadora ou empresa de integração de redes.',
  edu: 'Formação e certificações',
  eduItems: [
    { title: 'Licenciatura em redes e telecomunicações', bullets: ['Roteamento e comutação, endereçamento IP, VLAN, segurança de redes', 'Transmissão rádio, fibra ótica, sistemas GSM e 4G'] },
    { title: 'Certificação Cisco CCNA (Introduction to Networks)', bullets: ['Configuração de roteadores e switches, diagnóstico de redes'] },
    { title: 'Bacharelato técnico, série F (eletrónica)' },
  ],
  exp: 'Experiência profissional',
  expItems: [
    { title: 'Estagiária técnica de redes', period: 'Junho — Set. 2025', bullets: ['Instalação e cablagem de bastidores de rede nos clientes', 'Configuração de roteadores e switches Cisco', 'Testes de ligações de fibra ótica e relatórios de intervenção', 'Apoio às equipas de manutenção dos sites BTS'] },
    { title: 'Técnica voluntária', org: 'Clube de informática da ENSP', bullets: ['Instalação da rede Wi-Fi da sala de informática', 'Oficinas de introdução às redes para 60 estudantes'] },
  ],
  skills: 'Competências e certificações',
  skillItems: ['Redes LAN / WAN', 'Roteamento e comutação Cisco', 'Fibra ótica (fusão, testes OTDR)', 'Cablagem estruturada', 'Manutenção de sites de telecomunicações', 'Microsoft Office (Word, Excel, PowerPoint)', 'Inglês técnico', 'Trabalho em equipa e sob pressão'],
  langs: 'Línguas',
  langItems: [{ name: 'Francês', level: 'Fluente' }, { name: 'Lingala', level: 'Nativo' }, { name: 'Inglês', level: 'Intermédio' }, { name: 'Kituba', level: 'Fluente' }],
  hobbies: 'Interesses',
  hobbyItems: ['Futebol', 'Leitura', 'Música', 'Voluntariado associativo'],
};

// --- 1. L'assistant remplit le CV ----------------------------------------------------------------------------
// Ce que l'on écrit à l'assistant, et ce qu'il ajoute au CV à chaque message (la page se redessine à chaque fois).
export function fillScript(example) {
  const [edu, exp, skills, langs, hobbies] = example.sections;
  const base = { ...example, profile: { ...example.profile, title: '', summary: '' }, sections: [] };
  return [
    { user: 'Je suis Grâce, technicienne réseaux, licence à l’ENSP et certifiée Cisco CCNA.', reply: 'Identité et formation ajoutées.', resume: { ...base, profile: { ...base.profile, title: example.profile.title }, sections: [edu] } },
    { user: 'J’ai fait un stage de 4 mois chez MTN Congo : baies réseau, routeurs Cisco, fibre.', reply: 'Expérience et profil rédigés.', resume: { ...base, profile: { ...example.profile }, sections: [edu, exp] } },
    { user: 'Ajoute mes compétences et mes langues : français, lingala, anglais.', reply: 'C’est fait. Ton CV est complet.', resume: { ...example, sections: [edu, exp, skills, langs, hobbies] } },
  ];
}
