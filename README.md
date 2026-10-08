# Agent Desk

Gerenciador desktop local para sessões do Codex CLI e Claude Code, feito com Electron, React, Material UI e xterm.js.

## Rodar no Ubuntu

```bash
npm install
npm run dev
```

O Electron abre uma janela local com o Vite em `127.0.0.1`. O comando `npm install` também recompila `node-pty` para a versão do Electron instalada.

Não abra `http://127.0.0.1:5173` no Firefox ou em outro navegador: esse endereço sozinho não tem a ponte preload usada para controlar os CLIs. Use a janela “Agent Desk” aberta pelo `npm run dev`.

Use `npm run dev` com sua conta normal do Ubuntu. Para acessar sessões que ficam em `/root`, inicie explicitamente como root:

```bash
npm run dev:root
```

Esse modo passa `--no-sandbox` ao Electron, e os CLIs iniciados pelo app também rodam como root. Portanto, Codex e Claude terão acesso de administrador aos arquivos do sistema.

Inicie o modo root a partir de um terminal do desktop do Ubuntu. O launcher identifica o XWayland, autoriza o usuário local `root` com `xhost +SI:localuser:root` durante a execução e restaura a autorização anterior ao encerrar normalmente ou com Ctrl+C. Ele também inicia um D-Bus separado com `dbus-run-session`, evitando usar o barramento da conta normal como root. Se necessário, instale `x11-xserver-utils` e `dbus`.

## O que já funciona

- Lê históricos do Codex em `CODEX_HOME/sessions` (ou `~/.codex/sessions`).
- Usa o banco local `state_*.sqlite` do Codex em modo de leitura para obter a pasta atual, o título e a data das sessões. Mantém o índice JSONL como alternativa para versões antigas.
- Lê históricos do Claude Code em `CLAUDE_CONFIG_DIR/projects` (ou `~/.claude/projects`).
- Organiza os históricos em uma árvore de diretórios usando o `cwd` salvo em cada conversa.
- Abre sessões novas e retoma uma sessão com `codex resume <id> --cd <pasta>` ou `claude --resume <id>` na pasta atual da conversa.
- Cria um PTY por terminal e encaminha teclado, redimensionamento e saída ANSI para xterm.js.
- Mostra a atividade registrada nos transcripts e atualiza a biblioteca periodicamente.
- Lista mudanças Git do projeto da sessão ativa, destaca as detectadas depois da abertura do terminal e atualiza a cada três segundos.
- Abre o projeto ou um arquivo alterado no PhpStorm pelo launcher `phpstorm`/`phpstorm.sh` (ou por `PHPSTORM_EXECUTABLE`).

A interface não guarda credenciais nem chama as APIs dos provedores diretamente. Ela inicia os binários locais e usa a autenticação que cada CLI já tem. Os processos iniciados ficam vinculados à janela do Agent Desk; ao fechar o app, o processo recebe `SIGHUP`.

## Dependências do Ubuntu

`node-pty` usa código nativo. Se a instalação pedir ferramentas de compilação, instale `build-essential` e `python3` e execute `npm install` novamente.

## Limites da primeira versão

- Sessões que já estavam abertas em outro emulador de terminal não podem ser anexadas ao PTY do app. Elas aparecem no histórico e podem ser retomadas.
- O ícone de atividade é inferido pelos eventos gravados em cada transcript; versões futuras dos CLIs podem alterar o formato desses arquivos.
- As sessões iniciadas por esta janela são encerradas quando o aplicativo é fechado.
# agent-connectors
