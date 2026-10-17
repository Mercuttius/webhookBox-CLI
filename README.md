<p align="center">
  <img src="./logo.PNG" alt="Logo do WebhookBox" width="100%">
</p>

# WebhookBox

Uma caixa de entrada de webhooks para o terminal. Receba requisições HTTP, inspecione headers e body e reenvie eventos para suas aplicações. Sem interface web, conta ou senha. Os dados ficam na sua máquina.

## Requisitos e instalação

### Homebrew (macOS e Linux)

Adicione este repositório como tap e instale:

```sh
brew tap Mercuttius/webhookbox https://github.com/Mercuttius/webhookBox.git
brew install Mercuttius/webhookbox/webhookbox
webhookbox --version
webhookbox start
```

O Homebrew instala Node.js 24 e cloudflared como dependências. O comando `webhookbox` fica disponível em qualquer pasta, sem instalar pacotes globais pelo npm. O aplicativo continua em Node.js; a receita usa o runtime do Homebrew mesmo se outro Node estiver no PATH.

Em outro terminal, use `webhookbox events list` ou `webhookbox events watch`. Para receber da internet, encerre o servidor local e execute `webhookbox start --public`.

Para atualizar:

```sh
brew update
brew upgrade Mercuttius/webhookbox/webhookbox
```

Atualizar ou desinstalar a fórmula preserva o histórico no diretório do usuário. Se já instalou pelo npm, execute `npm uninstall -g webhookbox-cli` antes de instalar pelo Homebrew para evitar conflito de comandos. No Windows nativo, use a instalação direta abaixo.

### Instalação direta dos fontes

- Node.js **24 ou superior**, com npm. A versão 24 é a versão testada pelo projeto.
- macOS, Windows ou Linux. A automação do repositório está configurada para testar os três sistemas.
- Apenas para receber pela internet: [cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) e conexão com a internet.

Baixe o ZIP do repositório ou clone-o, abra um terminal na pasta extraída e execute:

```sh
npm ci
npm install --global .
webhookbox --help
```

Se o diretório global do npm não estiver acessível, use diretamente, sem instalação global:

```sh
node bin/webhookbox.js --help
node bin/webhookbox.js start
```

Os comandos abaixo usam `webhookbox`. Você pode substituí-lo por `node bin/webhookbox.js` enquanto estiver na pasta do projeto. O pacote ainda não foi publicado no npm; a instalação acima usa os arquivos baixados do GitHub.

## Primeiro webhook

Crie uma caixa e inicie o servidor:

```sh
webhookbox box create pagamentos
webhookbox start
```

O terminal exibirá a URL local completa da caixa. Se não houver nenhuma caixa, `start` cria uma chamada `default`.

Em outro terminal, envie um teste substituindo `URL_DA_CAIXA` pelo endereço exibido. Este exemplo usa Node.js e funciona nos três sistemas:

```sh
node -e "fetch('URL_DA_CAIXA', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({evento:'pagamento.aprovado',valor:49.90})}).then(async r=>console.log(r.status,await r.text()))"
```

Consulte os eventos e copie um ID completo:

```sh
webhookbox events list pagamentos
webhookbox events show ID_DO_EVENTO
webhookbox events watch pagamentos
```

`watch` mostra somente eventos que chegarem depois de sua inicialização. A consulta ocorre a cada segundo; não exige WebSockets. `Ctrl+C` encerra a observação ou o servidor no terminal em que foi pressionado. O histórico permanece no disco.

## Receber da internet

Instale `cloudflared` seguindo o [guia oficial de downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) para seu sistema e confira `cloudflared --version`. Depois:

```sh
webhookbox start --public
```

O programa abre um [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) e mostra uma URL HTTPS temporária para cada caixa. Não exige login no WebhookBox nem uma conta Cloudflare para esse tipo de túnel. O tráfego passa pela Cloudflare; limites e disponibilidade do serviço externo se aplicam. Quick Tunnels são destinados a testes, sem garantia de disponibilidade.

O endereço muda quando um novo túnel é criado. A máquina precisa permanecer ligada, conectada e com o processo ativo. A emissão da URL pode anteceder sua disponibilidade por alguns segundos. Arquivos de configuração existentes do cloudflared podem interferir com Quick Tunnels; consulte a documentação oficial antes de ajustá-los.

Se o executável não estiver no PATH:

```sh
webhookbox start --public --cloudflared CAMINHO_DO_EXECUTAVEL
```

O WebhookBox não baixa nem instala esse programa automaticamente. Se o processo do túnel encerrar, o WebhookBox encerra com erro; inicie novamente. Reconexões transitórias são gerenciadas pelo cloudflared.

Você pode usar outro túnel ou um proxy configurado por você, apontando para `http://127.0.0.1:3000`. Inicie sem `--public` e use `box list --base-url https://seu-endereco.example` para montar as URLs. Essa opção apenas formata os endereços; não cria um túnel nem configura DNS.

## Comandos

| Comando | Função |
| --- | --- |
| `start` | Inicia o servidor, em primeiro plano |
| `box create NOME` | Cria uma caixa com identificador aleatório |
| `box list` | Lista caixas e URLs |
| `box remove NOME --yes` | Remove uma caixa e todos os seus eventos |
| `events list [CAIXA]` | Lista os últimos eventos, mais recentes primeiro |
| `events show ID` | Exibe headers e body; formata JSON válido |
| `events watch [CAIXA]` | Acompanha eventos novos |
| `events replay ID --to URL` | Reenvia o evento e mostra a resposta |
| `events export ID --output ARQUIVO` | Exporta um evento em JSON, sem sobrescrever arquivos |
| `events delete ID --yes` | Apaga um evento |
| `events clear CAIXA --yes` | Apaga os eventos de uma caixa |
| `config` | Mostra diretório de dados e informações da execução |

Filtros e paginação:

```sh
webhookbox events list pagamentos --method POST --limit 20 --offset 20
webhookbox events list --since 2026-10-17T00:00:00Z
webhookbox events list --json
webhookbox events watch pagamentos --interval 500 --json
```

`--json` produz JSON sem mensagens decorativas; em `watch` e `start`, cada registro ocupa uma linha. Erros vão para stderr e retornam código de saída 1. `show --json` e a exportação preservam o body em base64, indicado por `body_encoding`. Headers são um array de pares nome/valor, preservando duplicatas e capitalização recebida pelo Node.js.

## Reenvio

```sh
webhookbox events replay ID_DO_EVENTO --to http://localhost:4000/webhook
webhookbox events replay ID_DO_EVENTO --to http://localhost:4000/webhook --remove-header Authorization --header "Authorization:Bearer token-de-teste" --timeout 15000
```

O método e os bytes do body são preservados. A URL de destino substitui completamente o caminho e os parâmetros originais. Headers de transporte, como `Host` e `Content-Length`, são recalculados; demais headers são reaproveitados, salvo remoção ou substituição explícita. `--header` e `--remove-header` podem ser repetidos.

Não há novas tentativas automáticas nem acompanhamento de redirecionamentos. Respostas HTTP a partir de 400 retornam código de saída 1. A prévia da resposta é limitada a 64 KiB e indica `truncated` quando cortada.

Reenviar pode repetir ações reais no destino. Credenciais dos headers originais também serão reenviadas, salvo remoção explícita. Assinaturas com prazo de validade podem ser rejeitadas; o WebhookBox não conhece os segredos dos provedores para gerar novas assinaturas.

## Configuração e armazenamento

```sh
webhookbox start --port 4000 --max-body 2097152 --max-events 5000 --retention-days 14 --rate-limit 240
webhookbox box list --base-url http://localhost:4000
webhookbox config
```

| Opção de `start` | Padrão | Significado |
| --- | --- | --- |
| `--port` | 3000 | Porta local |
| `--max-body` | 1048576 | Limite do body por evento, em bytes (1 MiB) |
| `--max-events` | 10000 | Quantidade máxima de eventos, somando todas as caixas |
| `--retention-days` | 7 | Remove eventos mais antigos ao iniciar e a cada minuto |
| `--rate-limit` | 120 | Máximo global de requisições por janela de um minuto |

Ao ultrapassar a quantidade máxima, os eventos mais antigos são removidos. Os limites de quantidade e tamanho não são uma quota exata de disco. SQLite reutiliza espaço liberado e o arquivo pode não diminuir imediatamente. A retenção só é executada enquanto o servidor está ativo.

Configurações de execução são passadas como opções e não ficam salvas entre reinícios. O banco SQLite fica em:

- macOS: `~/Library/Application Support/WebhookBox`
- Windows: `%LOCALAPPDATA%\WebhookBox`
- Linux: `$XDG_DATA_HOME/webhookbox` ou `~/.local/share/webhookbox`

Use `--data-dir CAMINHO` em **todos** os comandos ou configure a variável de ambiente `WEBHOOKBOX_DATA_DIR` para separar ambientes. Um banco deve ser usado por apenas um servidor receptor por vez; comandos de consulta podem rodar simultaneamente. Mantenha o banco em disco local. Para um backup simples, encerre os processos antes de copiar o diretório inteiro.

## Privacidade e comportamento HTTP

- Sem telemetria, autenticação ou sincronização remota própria.
- Servidor vinculado a `127.0.0.1`. Só `/hooks/IDENTIFICADOR` e subcaminhos recebem eventos; não há API HTTP administrativa.
- Quem conhece a URL da caixa pode enviar eventos. O identificador aleatório não é autenticação.
- Headers, parâmetros e bodies podem conter segredos. São salvos sem criptografia no disco, com permissões restritas em sistemas POSIX; no Windows aplicam-se as permissões da pasta do usuário.
- Sequências de controle são escapadas na exibição para não manipular o terminal. Exportações preservam os dados originais.
- Resposta `202` após persistência; `404` para rotas desconhecidas; `413` acima do tamanho permitido; `429` acima do limite global; `500` se a gravação falhar.
- O body é armazenado sem interpretar JSON nem descompactar. A captura reflete a requisição entregue pelo Node.js, não um pacote de rede bruto. Proxies e túneis podem adicionar ou alterar headers.
- O projeto recebe HTTP comum. Não implementa upgrades WebSocket, método CONNECT, resposta personalizada a desafios de provedores ou processamento de negócios.

## Desenvolvimento

```sh
npm ci
npm test
npm pack
```

Sem dependências de execução de terceiros: usa módulos nativos do Node.js, incluindo [`node:sqlite`](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html). Algumas versões do Node.js podem emitir um aviso sobre o status dessa API no stderr.

Estrutura:

```text
bin/                 Entrada do executável
src/cli.js           Comandos e saída no terminal
src/server.js        Recebimento HTTP e limites
src/store.js         Persistência, filtros e retenção
src/replay.js        Reenvio HTTP(S)
src/tunnel.js        Ciclo de vida do cloudflared
src/config.js        Diretórios, validação e exibição segura
test/                Testes de integração locais
.github/workflows/   Verificações em macOS, Windows e Linux
```

Os testes não dependem da internet. A validação pública real é manual: inicie `start --public`, envie um evento para a URL HTTPS, consulte-o localmente e encerre com Ctrl+C. A matriz do GitHub Actions só comprova compatibilidade quando executar com sucesso no repositório publicado.

## Distribuição

O nome `webhookbox-cli` é provisório e não teve disponibilidade confirmada no npm. O executável é `webhookbox`. Não há executáveis com Node.js embutido nesta versão.

Antes de publicar, siga [RELEASING.md](RELEASING.md). Contribuições: [CONTRIBUTING.md](CONTRIBUTING.md). Licença: [MIT](LICENSE).
