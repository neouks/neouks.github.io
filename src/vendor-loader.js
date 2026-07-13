const loadPromises = new Map();

export function loadGlobalScript(name, src) {
  if (window[name]) return Promise.resolve(window[name]);
  if (loadPromises.has(name)) return loadPromises.get(name);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', () => {
      if (window[name]) resolve(window[name]);
      else reject(new Error(`${name} 组件加载失败`));
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`${name} 组件加载失败`)), { once: true });
    document.head.appendChild(script);
  }).catch(error => {
    loadPromises.delete(name);
    throw error;
  });

  loadPromises.set(name, promise);
  return promise;
}
