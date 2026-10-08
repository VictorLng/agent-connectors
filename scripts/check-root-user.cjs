if (typeof process.getuid !== 'function' || process.getuid() !== 0) {
  console.error('`npm run dev:root` só deve ser usado em um shell root.');
  process.exit(1);
}
