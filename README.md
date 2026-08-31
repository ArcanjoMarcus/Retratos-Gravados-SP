# Retrato Gravado SP

Mapa em mosaico do centro de São Paulo. Cada quadrado é uma região; algumas
emitem um som contínuo que sobe, desce e caminha entre os canais esquerdo e
direito conforme o mouse se move pela tela.

## Versão 1 (esta)

Sistema mínimo, sem imagens: o mapa vetorizado, dez regiões com som e um ícone
de alto-falante marcando cada uma delas. Fundo preto, mapa e ícones em branco,
nada mais na página. Os sons são sintetizados no próprio navegador, então a
página funciona sem nenhum arquivo de mídia.

## Como rodar

O `index.html` abre direto no navegador com duplo clique. Para carregar
arquivos de áudio reais é preciso um servidor local, porque `fetch` não
funciona sob `file://`:

```
python3 -m http.server 8000
```

E abrir `http://localhost:8000`.

## Estrutura

```
retrato-gravado-sp/
├── index.html            estrutura da página e o SVG do mapa
├── css/
│   └── estilo.css        toda a aparência
├── js/
│   └── app.js            todo o comportamento, em cinco seções numeradas
├── assets/
│   ├── imagens/          fotos das regiões
│   └── audio/            gravações das regiões
└── README.md
```

O script é carregado no fim do `<body>`, sem sistema de módulos, para que a
página abra com duplo clique, sem servidor.

As seções de `js/app.js`, na ordem em que aparecem:

| seção | o que faz | frequência de edição |
| --- | --- | --- |
| 1. Configuração | parâmetros de comportamento | ocasional |
| 2. Índice de mídia | imagens e áudios por região | constante |
| 3. Mapa | leitura do SVG, indexação e camadas | rara |
| 4. Motor de áudio | um canal por região | rara |
| 5. Interação | mouse, laço de animação, inicialização | rara |

## Como preencher as regiões

Todo o trabalho de conteúdo acontece na seção 2 de `js/app.js`, no objeto
`MIDIA`.
A chave é o índice da região:

```js
const MIDIA = {
  9:  { imagem: 'assets/imagens/009-se.jpg', audio: 'assets/audio/009-se.mp3' },
  15: { imagem: 'assets/imagens/015-republica.jpg' },
  21: { som: true }
};
```

- `imagem` desliga o preenchimento branco do quadrado e coloca a foto no lugar,
  recortada pela forma da região.
- `audio` cria o canal de som e o ícone de alto-falante.
- `som: true` cria o canal usando o drone provisório, sem arquivo — é o que a
  v1 usa em todas as dez regiões sonoras.
- Índices fora dessa lista continuam no mapa, mudos e sem foto.

Quando todos os áudios estiverem no lugar, desligue
`CONFIG.audio.reproducao.sinteseComoReserva`, na seção 1.

Chaves opcionais para regiões com `audio`:

| chave | efeito |
| --- | --- |
| `ganho` | nível só desta gravação; 1 = como foi gravada |
| `inicio` / `fim` | recorte, em segundos, do trecho que entra no loop |
| `modo` | `'buffer'` ou `'stream'` só para esta região |
| `estereo` | `false` se a gravação for mono e o modo for `'stream'` |

## Distinguir uma região das outras

Duas coisas fazem uma gravação se destacar, e as duas estão em
`CONFIG.audio.foco`.

O motor soma dois campos de proximidade. O **campo amplo**
(`raioDeAlcance`, `curvaDeQueda`) é o fundo da cidade: largo, para a gravação
continuar presente enquanto o mouse atravessa o mapa. O **campo de foco**
(`foco.raio`, `foco.curva`) é estreito, do tamanho de um quadrado, e só pega
quando o cursor entra na região.

| chave | efeito |
| --- | --- |
| `foco.ganhoExtra` | quanto a região sob o mouse sobe. 0 desliga; 1.5 a 2.5 destaca sem apagar o resto |
| `foco.reducaoDosDemais` | quanto as outras recuam enquanto há um foco claro |
| `foco.raio` / `foco.curva` | tamanho e nitidez da borda do realce |

`reducaoDosDemais` costuma resolver mais que `ganhoExtra`. Subir só o ganho
aumenta a massa sonora total; abrir espaço em volta é o que deixa o detalhe
aparecer. Nos valores atuais a região em foco fica cerca de oito vezes acima
da segunda mais alta.

`CONFIG.visual.realceDoFoco` faz o mesmo realce no brilho do quadrado, para o
que salta aos olhos ser o que salta aos ouvidos.

## Nivelar gravações entre si

Captações feitas em dias, distâncias e ganhos diferentes chegam com níveis
muito diferentes, e as mais altas enterram o detalhe das mais baixas. Com
`CONFIG.audio.nivelamento.ativo`, o motor mede o RMS de cada arquivo ao
carregar e compensa antes de tudo.

| chave | efeito |
| --- | --- |
| `alvo` | nível de chegada. RMS por padrão; ~0.9 se `usarPico` |
| `ganhoMaximo` | teto do ajuste, para não amplificar chiado de uma gravação quase muda |
| `usarPico` | `false` nivela por energia média, `true` por pico (iguala menos, preserva dinâmica) |
| `relatorio` | escreve no console a tabela de níveis medidos |

O nivelamento só funciona no modo `buffer` — `stream` não dá acesso às
amostras. Ali, use `ganho` na região.

Se preferir controle manual, abra o console, copie a coluna `ganho` do
relatório para o índice de mídia e desligue `nivelamento.ativo`.

## Fidelidade e duração

Depois de decodificado, o arquivo passa só por ganho e panorama — nenhum
filtro, compressor ou mudança de andamento entre a gravação e a saída. Se a
soma das regiões estourar, baixe `volumeMestre`; não acrescente compressor.

Dois modos de reprodução, em `CONFIG.audio.reproducao.modo` ou região a
região:

| modo | quando usar | custo |
| --- | --- | --- |
| `buffer` | gravações curtas em loop | carrega e decodifica o arquivo inteiro na memória; emenda o loop sem falha |
| `stream` | gravações longas, de vários minutos | não carrega tudo nem espera decodificar; alguns navegadores deixam um respiro no ponto do loop |

No modo `buffer` a gravação inteira entra no loop: o que se ouve é o arquivo
todo, não um pedaço. `inicio` e `fim` existem para recortar de propósito, e
fora deles nada é cortado. O único ciclo curto do sistema é o drone
sintetizado das regiões sem arquivo, hoje em 20 segundos
(`CONFIG.audio.sintese.duracaoDoCiclo`).

Quanto tempo você ouve uma região depende do alcance, não do arquivo:
`raioDeAlcance` alto e `curvaDeQueda` baixa mantêm a gravação audível por boa
parte do trajeto do mouse.

Gravações estéreo perdem a imagem original se forem jogadas de ponta a ponta
entre os canais, então `panoramaMaximoEstereo` limita o deslocamento delas a
0.4. Material mono aceita o movimento inteiro. No modo `buffer` o motor
descobre sozinho se o arquivo é estéreo; no modo `stream` ele assume que sim,
salvo `estereo: false` na região.

Sobre formato: WAV ou FLAC preservam a gravação, MP3 e AAC não. Para loop sem
emenda no modo `buffer`, corte o arquivo em passagens por zero — ou use
`inicio` e `fim` para escolher o trecho.

## Numeração das regiões

Calculada na leitura do SVG, da esquerda para a direita e de cima para baixo,
começando em 0. Ligue `CONFIG.depuracao.mostrarIndices` para ver os números
desenhados sobre o mapa.

| linha | regiões |
| --- | --- |
| 1 | 00 Santana · 01 Vila Guilherme |
| 2 | 02 Bom Retiro · 03 Luz · 04 Pari · 05 Brás |
| 3 | 06 Barra Funda · 07 Campos Elíseos · 08 Santa Ifigênia · 09 Sé · 10 Belenzinho · 11 Mooca |
| 4 | 12 Perdizes · 13 Higienópolis · 14 Vila Buarque · 15 República · 16 Bexiga · 17 Cambuci · 18 Ipiranga |
| 5 | 19 Pacaembu · 20 Consolação · 21 Bela Vista · 22 Liberdade · 23 Aclimação · 24 Vila Mariana · 25 Vila Prudente |
| 6 | 26 Jardins · 27 Paraíso · 28 Vila Clementino · 29 Saúde · 30 Sacomã |
| 7 | 31 Itaim Bibi · 32 Moema · 33 Jabaquara |
| 8 | 34 Santo Amaro |

Com som na v1: 3, 6, 9, 12, 15, 18, 21, 24, 28, 32.

Os nomes são referência de trabalho, não geografia: o desenho é uma abstração
geométrica e as posições não correspondem ao mapa real da cidade.

## Ajustes de comportamento

Tudo o que vale mexer está no objeto `CONFIG`, na seção 1 de `js/app.js`:

| chave | efeito |
| --- | --- |
| `audio.raioDeAlcance` | até onde uma região é ouvida, e por quanto tempo |
| `audio.curvaDeQueda` | quão focado é o campo amplo |
| `audio.foco.ganhoExtra` | realce da região sob o mouse |
| `audio.foco.reducaoDosDemais` | quanto as outras recuam para abrir espaço |
| `audio.nivelamento.alvo` | nível em que todas as gravações chegam |
| `audio.pisoDeVolume` | volume que a região mantém mesmo longe; 0 silencia |
| `audio.raioDePanorama` | distância horizontal para o som ir ao extremo permitido |
| `audio.reproducao.modo` | `buffer` ou `stream` |
| `audio.reproducao.panoramaMaximoMono` / `...Estereo` | quanto o som pode se deslocar |
| `audio.suavizacao` | tempo de resposta às mudanças, em segundos |
| `visual.opacidadeMinima` / `opacidadeMaxima` | contraste do mapa em repouso e sob o mouse |
| `depuracao.mostrarIndices` | desenha o número de cada região |

`visual.opacidadeMinima` tem um espelho no CSS, a variável
`--opacidade-repouso`, que define o estado do mapa antes do primeiro
movimento do mouse. Mudou um, mude o outro.

No console, `RETRATO` expõe as regiões computadas, a configuração e o motor de
áudio.

## Trocar o desenho do mapa

O script não monta o mapa: ele lê o SVG que está no `index.html`. Qualquer
forma com o atributo `data-regiao` vira uma região, seja `rect`, `path` ou
`polygon`. Para usar um mapa vetorial real basta substituir as formas dentro
de `#camada-mapa`, mantendo esse atributo — índices, recortes de imagem,
ícones e canais de áudio são todos derivados da geometria de cada forma.

## Próximos passos sugeridos

- Fotos reais nas regiões, pelo `MIDIA`.
- Gravações de campo no lugar dos drones sintetizados.
- Mapa vetorial mais próximo do traçado da cidade.
- Alternativa para toque, já que a peça hoje depende do movimento do mouse.