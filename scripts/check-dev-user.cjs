if (typeof process.getuid === 'function' && process.getuid() === 0) {
  console.error('`npm run dev` usa o sandbox padrão e não deve ser executado como root.');
  console.error('Para acessar sessões armazenadas em /root, use `npm run dev:root`.');
  process.exit(1);
}
