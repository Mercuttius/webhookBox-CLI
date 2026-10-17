# Publicação pelo Homebrew

O repositório https://github.com/Mercuttius/webhookBox contém os fontes, as releases e a pasta `Formula/` usada como tap. Não é necessário outro repositório nem publicar no npm. A receita instala Node.js 24 e cloudflared.

## Preparar uma versão

Atualize a versão do package.json e do lockfile e registre as alterações no changelog. Execute:

```sh
npm ci
npm test
npm run release:prepare -- --repository Mercuttius/webhookBox
```

O gerador cria em `dist/` o pacote `.tgz`, `SHA256SUMS` e `webhookbox.rb`. A fórmula aponta para o arquivo da versão correspondente nas releases do GitHub. Se gerar novamente o pacote, use também a nova fórmula e checksum.

## Release no GitHub

Envie uma tag `vX.Y.Z` correspondente ao package.json. O workflow release.yml executa testes nos três sistemas e cria uma release em rascunho com pacote, fórmula e checksum. Revise e publique esse rascunho. Releases em rascunho não disponibilizam os arquivos para instalação pública.

Copie a fórmula anexada à release para `Formula/webhookbox.rb` na branch principal e envie a alteração. Use a fórmula da release, pois seu checksum corresponde ao pacote publicado. Não substitua artefatos de uma versão já publicada; faça uma nova versão.

## Testar pelo Homebrew

```sh
brew tap Mercuttius/webhookbox https://github.com/Mercuttius/webhookBox.git
brew install --build-from-source Mercuttius/webhookbox/webhookbox
brew test Mercuttius/webhookbox/webhookbox
brew audit --strict Mercuttius/webhookbox/webhookbox
```

O teste da fórmula cria, consulta e remove uma caixa em armazenamento temporário. Confira também recebimento local, reenvio e modo público. Se o Homebrew solicitar confiança explícita, verifique a origem e siga sua orientação.

O comando de tap com URL explícita é necessário porque usamos o mesmo repositório da aplicação, cujo nome não tem o prefixo homebrew-. Não há inclusão no catálogo oficial homebrew/core.

## Atualizações

Após publicar uma versão e atualizar a fórmula na branch principal, os usuários recebem a atualização com `brew update` seguido de `brew upgrade Mercuttius/webhookbox/webhookbox`. Desinstalar com `brew uninstall webhookbox` preserva o banco no diretório pessoal.

Referências: [taps próprios](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap), [receitas por linguagem](https://docs.brew.sh/Language-Specific-Formulae).
