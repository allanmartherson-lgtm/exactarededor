# Exacta - Pagamento Médico

Lovable, eu queria criar um app de fluxo de aprovação de pagamento médico, começando com a a analista fazendo o upload da base de pagamento, a inteligência artificial cruzaria os dados com a regra, depois iria para validação e depois da validação iria para aprovação do Diretor. E depois da validação, dispararia o email com o arquivo e informações para pedido de nota. 
Na validação, se o validador identificar um erro, ele precisa conseguir devolver para a analista, assim com o diretor também, caso haja erro. Além disso, seria mantido o histórico das observações feitas tanto pela IA como pelos validadores.
O sistema teria um menu/módulo para cadastro das regras ou upload do arquivo com regra que poderia converter para a regra que o sistema entenda. 
O sistema também teria controle das validações por usuário, visto que só diretor pode aprovar o pedido e ele geraria um pdf da validação dada.
Depois de validado, é disparado por email o pedido de nota com a planilha e corpo do email com informações fiscais e o valor a ser emitido.
Seria interessante o sistema conseguir identificar o email ou você sugere um link para ele inserir a nota no portal ? e assim que devolvida a nota, o sistema acusar e manter a nota enviada salva ? Seria ideal, também, que o sistema já cruzasse a nota com o pedido para garantir que o valor bruto esteja igual ou caso contrário, não conseguimos seguir com o pagamento.
Hoje todo esse fluxo é feito por email, o que é lento, se perder e não traz segurança. Além disso, a validação é feita totalmente no olho. A validação continuaria sendo feita, mas com apoio da inteligência artificial que iria aprendendo a medida que o analista, o validador ou diretor vai fazendo observações. Em uma segunda etapa, desenvolveriamos um app para o médico acompanhar o pagamento.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://exactarededor.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1d07beac-8028-420b-ab8b-15b99a77170a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
