"use strict";
/* ==========================================================================
   RETRATO GRAVADO SP — SCRIPT

   Mosaico geométrico do centro de São Paulo. Cada região é um quadrado do
   mosaico. Algumas regiões emitem um som contínuo cujo volume e posição
   estéreo respondem ao movimento do mouse.

   SUMÁRIO
     1. CONFIGURAÇÃO      parâmetros de comportamento
     2. ÍNDICE DE MÍDIA   imagens e áudios por região        <- conteúdo
     3. MAPA              leitura do SVG, indexação, camadas
        3.1  Referências ao documento
        3.2  Leitura e indexação
        3.3  Camadas (imagens, ícones, rótulos)
        3.4  Geometria auxiliar
     4. MOTOR DE ÁUDIO    um canal por região
     5. INTERAÇÃO         mouse, laço de animação, inicialização
        5.1  Estado
        5.2  Mouse
        5.3  Visual
        5.4  Laço de animação
        5.5  Inicialização

   O desenho do mapa não está aqui: ele é a marcação SVG dentro do
   index.html. Este arquivo apenas o lê.

   PONTOS DE EXTENSÃO estão marcados com o comentário [ATUALIZAR].
   ========================================================================== */

/* ==========================================================================
   1. CONFIGURAÇÃO
   Todos os números que valem a pena mexer estão aqui. Nenhum outro arquivo
   precisa ser editado para ajustar o comportamento da peça.
   ========================================================================== */

const CONFIG = {

  audio: {
    // ----------------------------------------------------------------------
    // Campo amplo: o fundo da cidade. Define até onde uma gravação continua
    // presente enquanto o mouse atravessa o mapa. Sozinho, ele empilha tudo
    // e nada se distingue — por isso existe o campo de foco, logo abaixo.
    // ----------------------------------------------------------------------

    // Raio de audição, em unidades do viewBox do SVG (1072 = largura total).
    raioDeAlcance: 720,

    // Expoente da queda de volume com a distância.
    // 1 = linear e generoso; 2 = seletivo; 3 = quase só o quadrado sob o mouse.
    curvaDeQueda: 1.6,

    // Volume que toda região mantém mesmo longe do mouse (0 a 1).
    // O som nunca cessa: ele apenas recua. Use 0 para silenciar ao longe.
    // Baixo de propósito: piso alto vira ruído de fundo que mascara detalhe.
    pisoDeVolume: 0.06,

    // ----------------------------------------------------------------------
    // Campo de foco: um segundo campo, estreito, do tamanho de um quadrado.
    // É ele que faz a região sob o mouse saltar à frente das outras. Some ao
    // campo amplo em vez de substituí-lo, então a cidade continua audível
    // ao redor da região em foco.
    // ----------------------------------------------------------------------
    foco: {
      // Raio do realce. ~140 é pouco mais que meio quadrado do mosaico:
      // o foco pega quando o mouse entra na região, não antes.
      raio: 150,

      // Curva do realce. Alta = borda nítida entre estar dentro e fora.
      curva: 2.6,

      // Quanto a região em foco ganha, somado ao campo amplo.
      // 0 desliga o realce; 1.5 a 2.5 é a faixa em que ela se destaca sem
      // apagar o resto.
      ganhoExtra: 1.8,

      // Quanto as OUTRAS regiões recuam enquanto existe um foco claro.
      // É esta linha, mais que o ganho extra, que dá nitidez: sem abrir
      // espaço, o realce só aumenta a massa sonora. 0 desliga.
      reducaoDosDemais: 0.6
    },

    // ----------------------------------------------------------------------
    // Nivelamento entre gravações. Captações feitas em dias, distâncias e
    // ganhos diferentes chegam com níveis muito diferentes, e as mais altas
    // enterram o detalhe das mais baixas. O motor mede cada arquivo ao
    // carregar e compensa antes de qualquer outra coisa.
    // Só funciona no modo 'buffer' — 'stream' não dá acesso às amostras.
    // ----------------------------------------------------------------------
    nivelamento: {
      ativo: true,

      // Nível alvo. Com `usarPico: false` é RMS (energia média): 0.2 é uma
      // faixa confortável para gravação de campo e deixa folga para o realce.
      // Com `usarPico: true`, mire perto de 0.9.
      alvo: 0.2,

      // Teto do ajuste, para cima e para baixo. Sem ele, uma gravação quase
      // silenciosa seria amplificada até o chiado aparecer.
      ganhoMaximo: 6,

      // false = nivela por energia média (o que o ouvido chama de volume).
      // true  = nivela por pico (preserva a dinâmica, iguala menos).
      usarPico: false,

      // Escreve no console uma tabela com o nível medido e o ganho aplicado
      // em cada região. Use para conferir o resultado e, se quiser, fixar os
      // valores como `ganho` no índice de mídia.
      relatorio: true
    },

    // Raio do panorama estéreo. Uma região a esta distância horizontal do
    // mouse é ouvida no extremo permitido pelos tetos de reprodução.
    raioDePanorama: 620,

    // Constante de tempo da suavização, em segundos. Valores baixos deixam a
    // resposta nervosa; valores altos deixam o som arrastado.
    suavizacao: 0.12,

    // Folga de pico. A conta: uma gravação nivelada em RMS 0.2 com dinâmica
    // típica de campo tem pico perto de 0.8; em foco ela chega a
    // piso + amplo + ganhoExtra ≈ 2.8. Então 0.8 x 2.8 x 0.32 ≈ 0.72, e sobra
    // margem para as outras somarem por baixo.
    // Se mexer em `ganhoExtra` ou em `nivelamento.alvo`, refaça a conta.
    // Se estourar, baixe este número — não acrescente compressor.
    volumeMestre: 0.32,

    // ----------------------------------------------------------------------
    // Reprodução: como o arquivo gravado chega ao alto-falante.
    // A cadeia é      fonte -> ganho da gravação -> distância -> panorama
    // e nada além disso. Sem filtro, sem compressor, sem mudança de andamento:
    // o arquivo sai como entrou, só com volume e posição.
    // ----------------------------------------------------------------------
    reproducao: {
      // 'buffer' baixa e decodifica o arquivo inteiro. O loop emenda sem
      //   falha nenhuma, o nivelamento funciona, mas a gravação toda ocupa
      //   memória.
      // 'stream' toca por um elemento <audio>, sem carregar tudo de uma vez.
      //   É o modo para gravações muito longas; em troca, não há nivelamento
      //   automático e alguns navegadores deixam um respiro no loop.
      // Pode ser sobreposto região a região no índice de mídia.
      modo: 'buffer',

      // Uma gravação estéreo perde a imagem original se for jogada de ponta a
      // ponta entre os canais. Estes tetos limitam o quanto o motor move o
      // som: material mono aceita o deslocamento inteiro, material estéreo
      // recebe só um empurrão de lado.
      panoramaMaximoMono: 1.0,
      panoramaMaximoEstereo: 0.4,

      // Regiões marcadas com `som: true`, sem arquivo, recebem o drone
      // sintetizado da v1. Uma região com `audio` que falhar ao carregar
      // também cai aqui — o erro aparece no console.
      // [ATUALIZAR] desligue quando todas as gravações estiverem no lugar.
      sinteseComoReserva: true
    },

    // Só afeta o drone provisório das regiões sem arquivo. Ciclo curto fica
    // reconhecível e cansa; 20 segundos já soa como textura, não como loop.
    sintese: {
      duracaoDoCiclo: 20
    }
  },

  visual: {
    // A opacidade da região acompanha o volume: o mapa mostra o que se ouve.
    // [ATUALIZAR] opacidadeMinima espelha --opacidade-repouso no CSS.
    opacidadeMinima: 0.14,
    opacidadeMaxima: 1.0,

    // Peso do campo de foco no brilho, para que a região realçada no som seja
    // também a que salta no mapa. 0 = o mapa ignora o foco.
    realceDoFoco: 0.7,

    responderAoMouse: true
  },

  depuracao: {
    // Desenha o índice de cada região sobre o mosaico. Útil para descobrir
    // qual número corresponde a qual quadrado antes de plugar as mídias.
    mostrarIndices: false
  }
};


/* ==========================================================================
   2. ÍNDICE DE MÍDIA
   Este é o único arquivo que precisa ser editado para preencher o mosaico.
   A chave é o índice da região, contado da esquerda para a direita e de cima
   para baixo, começando em 0.

     imagem : caminho do arquivo, relativo ao index.html.
     audio  : caminho do arquivo, relativo ao index.html.
     som    : true força a região a ter canal de áudio mesmo sem arquivo
              (usa a síntese provisória da v1).

   Opcionais, só para regiões com `audio`:
     ganho  : ajuste de nível desta gravação. 1 = como foi gravada. É o único
              lugar onde o sinal do arquivo é tocado.
     inicio : segundo em que a reprodução começa e para onde o loop volta.
     fim    : segundo em que o loop retorna ao início. Fora, usa o arquivo
              inteiro. `inicio` e `fim` valem só no modo 'buffer'.
     modo   : 'buffer' ou 'stream', sobrepondo CONFIG nesta região. Use
              'stream' em gravações longas, de vários minutos.
     estereo: informe false se a gravação for mono e o modo for 'stream'
              (no modo 'buffer' o motor descobre sozinho). Define qual teto
              de panorama se aplica.

   Regras:
     - Uma região só ganha canal de áudio (e ícone) se aparecer aqui com
       `audio` preenchido ou `som: true`.
     - Uma região com `imagem` preenchida tem o preenchimento branco desligado
       e passa a modular a opacidade da própria imagem.
     - Índices ausentes desta lista continuam existindo no mapa, mudos e sem
       imagem.

   Para descobrir os índices, ligue CONFIG.depuracao.mostrarIndices.

   MAPA DE ÍNDICES (linha a linha, como aparecem na tela)
     linha 1   00 Santana · 01 Vila Guilherme
     linha 2   02 Bom Retiro · 03 Luz · 04 Pari · 05 Brás
     linha 3   06 Barra Funda · 07 Campos Elíseos · 08 Santa Ifigênia ·
               09 Sé · 10 Belenzinho · 11 Mooca
     linha 4   12 Perdizes · 13 Higienópolis · 14 Vila Buarque ·
               15 República · 16 Bexiga · 17 Cambuci · 18 Ipiranga
     linha 5   19 Pacaembu · 20 Consolação · 21 Bela Vista · 22 Liberdade ·
               23 Aclimação · 24 Vila Mariana · 25 Vila Prudente
     linha 6   26 Jardins · 27 Paraíso · 28 Vila Clementino · 29 Saúde ·
               30 Sacomã
     linha 7   31 Itaim Bibi · 32 Moema · 33 Jabaquara
     linha 8   34 Santo Amaro

   [ATUALIZAR] adicionar imagens e áudios reais abaixo.
   ========================================================================== */

const MIDIA = {
  //  0: { imagem: 'assets/imagens/000-santana.jpg' },
  //  9: { imagem: 'assets/imagens/009-se.jpg', audio: 'assets/audio/009-se.wav' },
  // 15: { audio: 'assets/audio/015-republica.wav', inicio: 12, fim: 96 },
  // 18: { audio: 'assets/audio/018-ipiranga.mp3', modo: 'stream', ganho: 0.8 },

  3:  { audio: 'assets/audio/02-untitled.mp3'},
  30:  { audio: 'assets/audio/01-untitled.mp3'},
  9:  { audio: 'assets/audio/03-untitled.mp3'},
  25:  { audio: 'assets/audio/04-untitled.mp3'},
  5:  { audio: 'assets/audio/05-untitled.mp3'},
  14: { audio: 'assets/audio/14-untitled.mp3'},
  15: { audio: 'assets/audio/15-untitled.mp3'},
  20: { audio: 'assets/audio/20-untitled.mp3' }
};


/* ==========================================================================
   3. MAPA
   O mapa é lido do documento, não montado por código. Cada forma marcada com
   `data-regiao` no index.html vira uma região; a ordenação define o índice.
   ========================================================================== */

/* --------------------------------------------------------------------------
   3.1  Referências ao documento
   Este arquivo é carregado no fim do <body>, então o SVG já existe aqui.
   -------------------------------------------------------------------------- */

const NS = 'http://www.w3.org/2000/svg';

const svg           = document.getElementById('mapa');
const defs          = document.getElementById('recortes');
const camadaImagens = document.getElementById('camada-imagens');
const camadaIcones  = document.getElementById('camada-icones');
const camadaRotulos = document.getElementById('camada-rotulos');

/* --------------------------------------------------------------------------
   3.2  Leitura e indexação
   -------------------------------------------------------------------------- */

/**
 * Lê as formas do SVG e devolve as regiões já indexadas.
 * A geometria vem de getBBox(), então funciona para rect, path, polygon etc.
 */
function lerRegioes() {
  const formas = Array.from(svg.querySelectorAll('[data-regiao]'));

  const regioes = formas.map((el) => {
    const b = el.getBBox();
    return {
      el,
      nome: el.dataset.nome || '',
      x: b.x, y: b.y, largura: b.width, altura: b.height,
      cx: b.x + b.width / 2,
      cy: b.y + b.height / 2,
      indice: -1,
      midia: null,
      elImagem: null,
      canal: null
    };
  });

  // Tolerância de linha: duas regiões pertencem à mesma faixa horizontal se
  // seus centros verticais estiverem a menos de meia altura de distância.
  const alturaMedia = regioes.reduce((s, r) => s + r.altura, 0) / (regioes.length || 1);
  const ordenadas = ordenarEmLinhas(regioes, alturaMedia * 0.5);

  ordenadas.forEach((r, i) => {
    r.indice = i;
    r.el.dataset.indice = i;              // fica legível no inspetor
    r.midia = MIDIA[i] || null;
  });

  return ordenadas;
}

/**
 * Ordena da esquerda para a direita e de cima para baixo.
 * Agrupa primeiro em faixas horizontais e só depois ordena por x dentro de
 * cada faixa — assim o resultado não quebra se as formas não estiverem
 * perfeitamente alinhadas em uma grade.
 */
function ordenarEmLinhas(regioes, tolerancia) {
  const porY = regioes.slice().sort((a, b) => a.cy - b.cy);
  const linhas = [];

  for (const r of porY) {
    const atual = linhas[linhas.length - 1];
    if (atual && Math.abs(r.cy - atual.referenciaY) <= tolerancia) {
      atual.itens.push(r);
    } else {
      linhas.push({ referenciaY: r.cy, itens: [r] });
    }
  }

  linhas.forEach((l) => l.itens.sort((a, b) => a.cx - b.cx));
  return linhas.flatMap((l) => l.itens);
}

/** Uma região tem som se o índice de mídia disser que sim. */
function temSom(regiao) {
  return Boolean(regiao.midia && (regiao.midia.audio || regiao.midia.som));
}

/* --------------------------------------------------------------------------
   3.3  Camadas
   -------------------------------------------------------------------------- */

/**
 * Cria, para cada região, um clipPath com a cópia da forma e um <image> preso
 * a ele. O <image> já existe mesmo sem arquivo: na v1 fica vazio, e na v2
 * basta preencher o href pelo índice de mídia.
 */
function montarImagens(regioes) {
  for (const r of regioes) {
    const idRecorte = `recorte-${r.indice}`;

    const clip = document.createElementNS(NS, 'clipPath');
    clip.setAttribute('id', idRecorte);

    const copia = r.el.cloneNode(false);        // a própria geometria da região
    copia.removeAttribute('data-regiao');       // a cópia não é uma região
    copia.removeAttribute('class');
    clip.appendChild(copia);
    defs.appendChild(clip);

    const img = document.createElementNS(NS, 'image');
    img.setAttribute('x', r.x);
    img.setAttribute('y', r.y);
    img.setAttribute('width', r.largura);
    img.setAttribute('height', r.altura);
    img.setAttribute('clip-path', `url(#${idRecorte})`);
    // 'slice' preenche o quadrado inteiro, cortando o excedente da foto.
    img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    img.setAttribute('opacity', CONFIG.visual.opacidadeMinima);

    const caminho = r.midia && r.midia.imagem;
    if (caminho) {
      img.setAttribute('href', caminho);
      // Com foto no lugar, o quadrado branco sai de cena.
      r.el.style.fillOpacity = '0';
    }

    camadaImagens.appendChild(img);
    r.elImagem = caminho ? img : null;
  }
}

/** Ícone de som: alto-falante em traço branco, centralizado na região. */
function montarIcones(regioes) {
  for (const r of regioes) {
    if (!temSom(r)) continue;

    const lado = Math.min(r.largura, r.altura);
    const escala = (lado * 0.34) / 24;       // ícone desenhado numa caixa 24x24

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'icone');
    g.setAttribute('transform',
      `translate(${r.cx - 12 * escala} ${r.cy - 12 * escala}) scale(${escala})`);
    g.innerHTML =
      '<path d="M3 9.2h3.6L11 5.4v13.2L6.6 14.8H3z" fill="currentColor" ' +
      'stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<path d="M14.4 9.4a4.4 4.4 0 0 1 0 5.2" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M17.4 6.8a8 8 0 0 1 0 10.4" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';

    camadaIcones.appendChild(g);
  }
}

/** Rótulos numéricos de depuração. */
function montarRotulos(regioes) {
  if (!CONFIG.depuracao.mostrarIndices) return;
  for (const r of regioes) {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('class', 'rotulo');
    t.setAttribute('x', r.cx);
    t.setAttribute('y', r.y + 26);
    t.textContent = String(r.indice);
    camadaRotulos.appendChild(t);
  }
}

/* --------------------------------------------------------------------------
   3.4  Geometria auxiliar
   Usada tanto pelo áudio quanto pelo visual: as duas coisas respondem à mesma
   medida de proximidade, para que o que se vê corresponda ao que se ouve.
   -------------------------------------------------------------------------- */

function limitar(v, min, max) {
  return v < min ? min : (v > max ? max : v);
}

/**
 * Campo de proximidade: quanto o mouse "pesa" sobre uma região, de 0 a 1.
 * Um raio grande com curva baixa desenha o campo amplo (o fundo da cidade);
 * um raio pequeno com curva alta desenha o campo de foco (a região sob o
 * cursor). O som e o mapa usam os dois, para que o que salta aos olhos seja
 * o mesmo que salta aos ouvidos.
 */
function campo(regiao, mx, my, raio, curva) {
  const d = Math.hypot(regiao.cx - mx, regiao.cy - my);
  const bruto = 1 - d / raio;
  return bruto > 0 ? Math.pow(bruto, curva) : 0;
}

/** Converte coordenadas da tela para o sistema de coordenadas do SVG. */
function paraCoordenadasDoSvg(clienteX, clienteY) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const ponto = new DOMPoint(clienteX, clienteY);
  return ponto.matrixTransform(ctm.inverse());
}


/* ==========================================================================
   4. MOTOR DE ÁUDIO
   Um canal por região sonora:
       fonte -> ganho da gravação -> ganho por distância -> panorama -> mestre

   A cadeia é curta de propósito. Depois que o arquivo é decodificado, o único
   processamento é volume e posição — nenhum filtro, compressor ou mudança de
   andamento entra entre a gravação e a saída.

   A fonte é o arquivo do índice de mídia, tocado em loop pelo modo 'buffer'
   (arquivo inteiro na memória, emenda perfeita) ou 'stream' (transmitido
   conforme toca, para gravações longas). Regiões sem arquivo recebem o drone
   sintetizado da v1.
   ========================================================================== */

// Escala pentatônica: uma frequência base por região sonora, para que os
// drones se sobreponham sem brigar. [ATUALIZAR] irrelevante na v2, quando os
// arquivos reais substituírem a síntese.
const ESCALA = [98.00, 110.00, 130.81, 146.83, 174.61,
                196.00, 220.00, 261.63, 293.66, 349.23];

const motor = {
  ctx: null,
  mestre: null,
  canais: [],
  elementos: [],          // <audio> em uso no modo 'stream', para não sumirem
  ligado: false,

  /** Chamado depois do primeiro clique — antes disso o navegador bloqueia. */
  async iniciar(regioes) {
    if (this.ligado) return;
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) return;                 // navegador sem Web Audio: só o mapa

    this.ctx = new Contexto();
    await this.ctx.resume();

    this.mestre = this.ctx.createGain();
    this.mestre.gain.value = CONFIG.audio.volumeMestre;
    this.mestre.connect(this.ctx.destination);

    const sonoras = regioes.filter(temSom);
    for (let i = 0; i < sonoras.length; i++) {
      const canal = await this.criarCanal(sonoras[i], i);
      if (canal) { sonoras[i].canal = canal; this.canais.push(canal); }
    }

    this.ligado = true;
    if (CONFIG.audio.nivelamento.relatorio) this.relatarNiveis(sonoras);
  },

  /**
   * Tabela no console com o que foi medido em cada gravação. Serve para
   * conferir o nivelamento e, se quiser deixá-lo fixo, copiar os valores da
   * coluna `ganho` para o índice de mídia e desligar `nivelamento.ativo`.
   */
  relatarNiveis(sonoras) {
    const linhas = sonoras
      .filter((r) => r.nivelMedido)
      .map((r) => ({
        indice: r.indice,
        regiao: r.nome,
        rms: Number(r.nivelMedido.rms.toFixed(4)),
        pico: Number(r.nivelMedido.pico.toFixed(3)),
        ganho: Number(r.ganhoAplicado.toFixed(3))
      }));

    if (!linhas.length) return;
    console.groupCollapsed('Retrato Gravado SP — níveis das gravações');
    console.table(linhas);
    console.groupEnd();
  },

  /**
   * Monta a cadeia de uma região:
   *   fonte -> ganho da gravação -> ganho por distância -> panorama -> mestre
   * Nada mais entra no caminho do sinal.
   */
  async criarCanal(regiao, ordem) {
    const midia = regiao.midia || {};
    const caminho = midia.audio;

    let fonte = null;
    if (caminho) {
      fonte = await this.fonteDeArquivo(regiao, caminho);
    }
    if (!fonte && CONFIG.audio.reproducao.sinteseComoReserva) {
      fonte = { no: this.fonteSintetizada(ordem), estereo: false, sintetizada: true };
    }
    if (!fonte) return null;

    // Ajuste de nível da própria gravação: o ganho manual da região vezes a
    // compensação medida no arquivo. Único ponto onde o material é tocado,
    // e mesmo assim só em volume.
    const manual = typeof midia.ganho === 'number' ? midia.ganho : 1;
    const automatico = this.nivelAutomatico(fonte.analise);

    const nivel = this.ctx.createGain();
    nivel.gain.value = manual * automatico;

    // Guardado para o relatório no console.
    regiao.nivelMedido = fonte.analise || null;
    regiao.ganhoAplicado = manual * automatico;

    // Volume por distância do mouse.
    const ganho = this.ctx.createGain();
    ganho.gain.value = 0;                  // entra desde o silêncio

    // StereoPannerNode não existe em navegadores antigos; sem ele o som
    // continua funcionando, só perde a lateralidade.
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;

    fonte.no.connect(nivel);
    nivel.connect(ganho);
    if (pan) { ganho.connect(pan); pan.connect(this.mestre); }
    else     { ganho.connect(this.mestre); }

    // Gravação estéreo se move menos, para a imagem original sobreviver.
    const tetoPan = fonte.estereo
      ? CONFIG.audio.reproducao.panoramaMaximoEstereo
      : CONFIG.audio.reproducao.panoramaMaximoMono;

    return { regiao, ganho, pan, tetoPan };
  },

  /** Escolhe o modo de reprodução e devolve { no, estereo }. */
  async fonteDeArquivo(regiao, caminho) {
    const modo = regiao.midia.modo || CONFIG.audio.reproducao.modo;
    try {
      return modo === 'stream'
        ? this.fonteEmStream(regiao, caminho)
        : await this.fonteEmBuffer(regiao, caminho);
    } catch (erro) {
      console.error(`Áudio não carregado no modo '${modo}': ${caminho}`, erro);
      return null;                          // cai na síntese de reserva
    }
  },

  /**
   * Arquivo inteiro na memória. Loop sem emenda, posição de início e fim
   * controláveis. Exige servidor HTTP (não file://).
   */
  async fonteEmBuffer(regiao, caminho) {
    const resposta = await fetch(caminho);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const dados = await resposta.arrayBuffer();
    const buffer = await this.ctx.decodeAudioData(dados);

    const inicio = limitar(regiao.midia.inicio || 0, 0, buffer.duration);
    const fim = limitar(regiao.midia.fim || buffer.duration, inicio, buffer.duration);

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = inicio;
    src.loopEnd = fim;
    src.playbackRate.value = 1;             // andamento original, sempre
    src.start(0, inicio);

    return {
      no: src,
      estereo: buffer.numberOfChannels > 1,
      duracao: fim - inicio,
      analise: this.medirNivel(buffer, inicio, fim)
    };
  },

  /**
   * Mede energia média (RMS) e pico do trecho que vai tocar. Amostra o
   * arquivo em passos, em vez de percorrer tudo: em gravações longas a
   * diferença de precisão é desprezível e a de tempo, não.
   */
  medirNivel(buffer, inicio, fim) {
    const taxa = buffer.sampleRate;
    const de = Math.floor(inicio * taxa);
    const ate = Math.min(buffer.length, Math.floor(fim * taxa));
    const passo = Math.max(1, Math.floor((ate - de) / 200000));

    let soma = 0, contagem = 0, pico = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const dados = buffer.getChannelData(c);
      for (let i = de; i < ate; i += passo) {
        const v = dados[i];
        soma += v * v;
        contagem++;
        const abs = v < 0 ? -v : v;
        if (abs > pico) pico = abs;
      }
    }

    return { rms: contagem ? Math.sqrt(soma / contagem) : 0, pico };
  },

  /**
   * Compensação de nível a partir da medição. Sem isso, uma captação feita de
   * perto num dia de movimento enterra o detalhe de outra feita de longe.
   */
  nivelAutomatico(analise) {
    const N = CONFIG.audio.nivelamento;
    if (!N.ativo || !analise) return 1;

    const referencia = N.usarPico ? analise.pico : analise.rms;
    if (!referencia) return 1;

    return limitar(N.alvo / referencia, 1 / N.ganhoMaximo, N.ganhoMaximo);
  },

  /**
   * Reprodução por elemento <audio>: o arquivo é transmitido conforme toca,
   * então gravações de vários minutos entram sem carregar tudo na memória e
   * sem esperar a decodificação. Em troca, o loop pode ter um respiro curto.
   */
  fonteEmStream(regiao, caminho) {
    const el = new Audio();
    el.src = caminho;
    el.loop = true;
    el.preload = 'auto';
    el.playbackRate = 1;

    if (regiao.midia.inicio) {
      el.addEventListener('loadedmetadata', () => {
        el.currentTime = regiao.midia.inicio;
      }, { once: true });
    }
    el.addEventListener('error', () => {
      console.error(`Áudio não carregado no modo 'stream': ${caminho}`);
    });

    const no = this.ctx.createMediaElementSource(el);
    el.play().catch((erro) => console.warn(`Reprodução recusada: ${caminho}`, erro));

    this.elementos.push(el);                // segura a referência
    return { no, estereo: regiao.midia.estereo !== false };
  },

  /**
   * Drone provisório da v1: ruído passado por um filtro passa-banda estreito,
   * mais uma senoide grave, com o filtro oscilando lentamente. Nenhum arquivo
   * externo envolvido.
   */
  fonteSintetizada(ordem) {
    const freq = ESCALA[ordem % ESCALA.length];
    const saida = this.ctx.createGain();

    // Ruído em loop. Ciclo longo para o ouvido não reconhecer a repetição.
    const duracao = CONFIG.audio.sintese.duracaoDoCiclo;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duracao, this.ctx.sampleRate);
    const dados = buffer.getChannelData(0);
    for (let i = 0; i < dados.length; i++) dados[i] = Math.random() * 2 - 1;

    const ruido = this.ctx.createBufferSource();
    ruido.buffer = buffer;
    ruido.loop = true;

    const filtro = this.ctx.createBiquadFilter();
    filtro.type = 'bandpass';
    filtro.frequency.value = freq * 2;
    filtro.Q.value = 16;

    const ganhoRuido = this.ctx.createGain();
    ganhoRuido.gain.value = 7;              // passa-banda estreito derruba muito nível

    // Oscilação lenta do filtro, para o drone não ficar parado.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.05 + (ordem % 5) * 0.03;
    const profundidade = this.ctx.createGain();
    profundidade.gain.value = freq * 0.25;
    lfo.connect(profundidade);
    profundidade.connect(filtro.frequency);
    lfo.start();

    // Corpo grave.
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq;
    const ganhoSub = this.ctx.createGain();
    ganhoSub.gain.value = 0.22;

    ruido.connect(filtro);
    filtro.connect(ganhoRuido);
    ganhoRuido.connect(saida);
    sub.connect(ganhoSub);
    ganhoSub.connect(saida);

    ruido.start();
    sub.start();
    return saida;
  },

  /**
   * Ajusta volume e panorama de cada canal a partir da posição do mouse,
   * já convertida para coordenadas do SVG.
   *
   * O volume de cada região é
   *     piso + campo amplo          -> a cidade ao redor
   *     x  abafamento               -> recua quem não está em foco
   *     +  realce                   -> avança quem está
   * Duas passagens: a primeira mede o foco de todos para saber se existe um
   * líder; a segunda aplica. Sem isso não daria para abafar os demais.
   */
  atualizar(mx, my) {
    if (!this.ligado) return;
    const A = CONFIG.audio;
    const F = A.foco;
    const agora = this.ctx.currentTime;

    // Passagem 1: quem está em foco, e quão claro é esse foco.
    let lider = 0;
    for (const canal of this.canais) {
      canal.foco = campo(canal.regiao, mx, my, F.raio, F.curva);
      if (canal.foco > lider) lider = canal.foco;
    }

    // Passagem 2: volume e posição.
    for (const canal of this.canais) {
      const amplo = campo(canal.regiao, mx, my, A.raioDeAlcance, A.curvaDeQueda);

      let volume = A.pisoDeVolume + (1 - A.pisoDeVolume) * amplo;
      volume *= 1 - F.reducaoDosDemais * lider * (1 - canal.foco);
      volume += F.ganhoExtra * canal.foco;

      canal.ganho.gain.setTargetAtTime(volume, agora, A.suavizacao);

      if (canal.pan) {
        // Região à esquerda do mouse soa à esquerda; à direita, à direita.
        // O teto preserva a imagem de gravações estéreo.
        const lado = limitar((canal.regiao.cx - mx) / A.raioDePanorama, -1, 1);
        canal.pan.pan.setTargetAtTime(lado * canal.tetoPan, agora, A.suavizacao);
      }
    }
  }
};


/* ==========================================================================
   5. INTERAÇÃO E INICIALIZAÇÃO
   Toda a peça responde a uma coisa só: onde o mouse está.
   ========================================================================== */

/* --------------------------------------------------------------------------
   5.1  Estado
   -------------------------------------------------------------------------- */

const mouse = { x: 536, y: 536 };          // começa no centro do viewBox
let regioes = [];
let precisaAtualizar = true;               // só recalcula quando algo muda

/* --------------------------------------------------------------------------
   5.2  Mouse
   -------------------------------------------------------------------------- */

function aoMover(evento) {
  const p = paraCoordenadasDoSvg(evento.clientX, evento.clientY);
  if (!p) return;
  mouse.x = p.x;
  mouse.y = p.y;
  precisaAtualizar = true;
}

/* --------------------------------------------------------------------------
   5.3  Visual
   Opacidade das regiões acompanhando o volume percebido: o mapa mostra o que
   se ouve. Desligue em CONFIG.visual.responderAoMouse para um mosaico fixo.
   -------------------------------------------------------------------------- */

function atualizarVisual() {
  if (!CONFIG.visual.responderAoMouse) return;
  const { opacidadeMinima, opacidadeMaxima, realceDoFoco } = CONFIG.visual;
  const { raioDeAlcance, curvaDeQueda, foco } = CONFIG.audio;

  for (const r of regioes) {
    const amplo = campo(r, mouse.x, mouse.y, raioDeAlcance, curvaDeQueda);
    const nitido = campo(r, mouse.x, mouse.y, foco.raio, foco.curva);

    // Mesma soma que o som faz: fundo largo mais realce estreito.
    const f = limitar(amplo + nitido * realceDoFoco, 0, 1);
    const op = opacidadeMinima + (opacidadeMaxima - opacidadeMinima) * f;

    if (r.elImagem) r.elImagem.setAttribute('opacity', op.toFixed(3));
    else r.el.style.fillOpacity = op.toFixed(3);
  }
}

/* --------------------------------------------------------------------------
   5.4  Laço de animação
   Um único laço para o visual e para o áudio, para que os dois nunca saiam
   de sincronia. [ATUALIZAR] animações futuras entram aqui dentro.
   -------------------------------------------------------------------------- */

function laco() {
  if (precisaAtualizar) {
    atualizarVisual();
    motor.atualizar(mouse.x, mouse.y);
    precisaAtualizar = false;
  }
  requestAnimationFrame(laco);
}

/* --------------------------------------------------------------------------
   5.5  Inicialização
   -------------------------------------------------------------------------- */

function iniciar() {
  regioes = lerRegioes();
  montarImagens(regioes);
  montarIcones(regioes);
  montarRotulos(regioes);

  window.addEventListener('pointermove', aoMover, { passive: true });
  window.addEventListener('resize', () => { precisaAtualizar = true; });
  requestAnimationFrame(laco);

  // O áudio só pode começar depois de um gesto do usuário.
  const entrada = document.getElementById('entrada');
  entrada.addEventListener('click', async () => {
    entrada.classList.add('saindo');
    setTimeout(() => { entrada.hidden = true; }, 600);
    await motor.iniciar(regioes);
    precisaAtualizar = true;
  }, { once: true });

  // Atalho de inspeção no console: RETRATO.regioes, RETRATO.CONFIG, etc.
  window.RETRATO = { regioes, CONFIG, MIDIA, motor };
}

document.addEventListener('DOMContentLoaded', iniciar);