# Integração Firebase — Fazendinha da Cecília

## Serviços conectados no aplicativo
- Firebase Authentication com login anônimo.
- Cloud Firestore para metadados das fotografias.
- Cloud Storage para arquivos JPEG.
- Galeria pública: leitura liberada sem cadastro.
- Envio automático após a captura: exige sessão autenticada anonimamente.
- A fotografia final é composta com `assets/moldura-cecilia-nova.png`, preenchendo a abertura da moldura sem fundo desfocado nem faixas duplicadas.
- Se o envio falhar, a tela mantém a opção de tentar novamente e permite baixar a foto localmente.
- Alteração e exclusão: bloqueadas pelas regras desta versão.

## Caminhos utilizados
- Firestore: `events/cecilia-1-aninho/photos/{documentId}`
- Storage: `events/cecilia-1-aninho/photos/{photoId}.jpg`

Cada documento contém `storagePath`, `downloadURL`, `createdAt`, `contentType` e `sizeBytes`.

## Configuração
O arquivo `firebase-config.js` contém a configuração pública do SDK Web do projeto. A configuração do SDK não é uma credencial administrativa. Nunca inclua chaves privadas, service accounts ou credenciais de servidor no repositório ou no navegador.

## Publicação obrigatória das regras
No Firebase Console, abra Firestore Database > Regras, substitua pelo conteúdo de `firestore.rules` e clique em Publicar.
Depois abra Storage > Regras, substitua pelo conteúdo de `storage.rules` e clique em Publicar.

As regras permitem leitura pública, criação de fotos com autenticação anônima e bloqueiam update/delete. Nesta versão não há painel administrativo nem exclusão administrativa implementada.

## Netlify
- Build command: vazio.
- Publish directory: `.`
- Base directory: vazio.
- O site deve ser servido por HTTPS para acesso à câmera.
- Depois de criar o domínio Netlify, adicione-o em Firebase Authentication > Configurações > Domínios autorizados.

## Testes antes de divulgar o QR Code
1. Abrir a URL HTTPS no Android e no iPhone e autorizar a câmera.
2. Tirar uma foto; o aplicativo salva uma cópia local e inicia automaticamente o envio ao Storage e o registro no Firestore.
3. Abrir a galeria em outro navegador/dispositivo e confirmar a foto.
4. Confirmar no Firebase Storage que o JPEG foi armazenado e no Firestore que os metadados foram registrados.
5. Verificar que não é possível alterar ou excluir fotos como convidado.
6. Em Authentication > Settings > Authorized domains, adicionar o domínio exato do site Netlify publicado. Sem essa autorização, o login anônimo pode falhar e bloquear o envio.
7. Confirmar em Authentication > Sign-in method que o provedor Anonymous está habilitado.
8. Monitorar faturamento e tráfego: alertas de orçamento não são limites rígidos de cobrança.

## Limites
- JPEG até 8 MB por fotografia.
- A galeria e os arquivos são públicos nesta configuração, portanto qualquer pessoa que obtenha o link pode visualizar/baixar as imagens. Avise os convidados e obtenha autorização apropriada antes de publicar fotos de pessoas, especialmente crianças.
