# Agents Monitor

Painel ao vivo, ao lado do chat, que mostra o que os agentes do Claude Code estão fazendo na sessão: a sessão principal, os subagentes em paralelo e o que cada um está executando, as consultas ao advisor, uma linha do tempo das ferramentas, o uso de contexto e as páginas da wiki do projeto que foram lidas e escritas. Os fios entre agentes e páginas animam conforme a informação flui.

## Uso

- Rode `/agents-monitor` para abrir o painel. Ele passa a abrir sozinho nas próximas sessões; fechar o painel desliga a abertura automática.
- No terminal, o painel aparece como texto; no app desktop, como um desenho animado.
- Páginas de wiki são reconhecidas em pastas `docs/`. Se a resposta do agente começar com `Wiki: pagina, pagina`, o painel compara as páginas declaradas com as realmente abertas.

## Demo

`node scripts/build-demo.mjs` gera `demo/agent-monitor-demo.html`, uma sessão fictícia com play, pause e reset.

## Desenvolvimento

- Testes: `claude plugin test .`
- Validação: `claude plugin validate .`

## Instalação

```bash
claude plugin marketplace add allanscofield/agents-monitor
claude plugin install agents-monitor@agents-monitor
```

Depois rode `/reload-plugins` (ou abra uma nova sessão) e `/agents-monitor`.
