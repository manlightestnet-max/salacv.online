// Pont minimal entre la page et le système (contextIsolation) : enregistrer un fichier à
// l'endroit choisi, puis l'ouvrir ou montrer son dossier. Rien d'autre n'est exposé.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  // data : ArrayBuffer ; filters : [{ name: 'PDF', extensions: ['pdf'] }] → { ok, path } | { canceled }
  saveFile: (name, data, filters) => ipcRenderer.invoke('desktop:save', { name, data, filters }),
  open: (path) => ipcRenderer.invoke('desktop:open', path),
  // Connexion : identifiant de ce PC (clés en ligne), clé hors ligne, Google dans le navigateur système.
  deviceId: () => ipcRenderer.invoke('desktop:device'),
  license: {
    status: () => ipcRenderer.invoke('desktop:license', { action: 'status' }),
    activate: (key) => ipcRenderer.invoke('desktop:license', { action: 'activate', key }),
    clear: () => ipcRenderer.invoke('desktop:license', { action: 'clear' }),
  },
  googleStart: () => ipcRenderer.invoke('desktop:google-start'),
  // Connexion Google terminée dans le navigateur : appelé une fois le jeton rangé dans le coffre. Retourne de quoi se désabonner.
  onSignedIn: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('desktop:signed-in', listener);
    return () => ipcRenderer.removeListener('desktop:signed-in', listener);
  },
  reveal: (path) => ipcRenderer.invoke('desktop:reveal', path),
});
