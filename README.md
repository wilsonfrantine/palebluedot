# O Pálido Ponto Azul

Simulador interativo de escala astronômica do Sistema Solar, em Português do Brasil. Inspirado em [If the Moon Were Only 1 Pixel](https://joshworth.com/dev/pixelspace/pixelspace_solarsystem.html) de Josh Worth.

## Sobre o projeto

A escala padrão é de **1 px ≈ 3.000 km**. O usuário pode navegar arrastando, rolando o mouse ou usando o minimapa superior para saltar entre os planetas, e ampliar com `Ctrl + scroll`.

## Funcionalidades

- **Navegação livre** — arraste ou role o mouse para explorar o Sistema Solar em escala real
- **Zoom dinâmico** — `Ctrl + scroll` para aumentar/diminuir; clique em um astro ou seu nome para zoom automático com animação suave
- **Minimapa** — barra superior com todos os planetas em escala √ (raiz quadrada) e indicador "você está aqui"
- **Luas** — principais satélites naturais de cada planeta posicionados em suas distâncias orbitais reais
- **Anéis planetários** — Júpiter (tênue), Saturno (prominente), Urano e Netuno
- **Cinturões e nuvens** — Cinturão de Asteroides, Cinturão de Kuiper e Nuvem de Oort renderizados na escala correta
- **Velocidade da luz** — modo de viagem automática na velocidade real da luz, convertida para a escala
- **Régua astronômica** — painel inferior com distância em km, UA e ano-luz em tempo real
- **Curiosidades** — fatos didáticos exibidos ao passar por marcos importantes

## Como usar

Abra `index.html` diretamente no navegador (não requer servidor).

```
git clone <repo>
cd palebluedot
# Abra index.html no navegador
```

## Adicionando fotos dos planetas

Coloque as imagens na pasta `photos/` com os seguintes nomes de arquivo:

| Planeta  | Arquivo sugerido |
|----------|-----------------|
| Sol      | `sun.jpg`       |
| Mercúrio | `mercury.jpg`   |
| Vênus    | `venus.jpg`     |
| Terra    | `earth.jpg`     |
| Marte    | `mars.jpg`      |
| Júpiter  | `jupiter.jpg`   |
| Saturno  | `saturn.jpg`    |
| Urano    | `uranus.jpg`    |
| Netuno   | `neptune.jpg`   |
| Plutão   | `pluto.jpg`     |

Para ativar a foto de um planeta, atualize o campo `photo` no array `celestialBodies` em `script.js`:

```js
{ id: 'earth', name: 'Terra', ..., photo: 'earth.jpg', ... }
```

A imagem aparecerá automaticamente quando o planeta estiver grande o suficiente na tela (diâmetro > 20px).

## Estrutura do projeto

```
palebluedot/
├── index.html       # Estrutura HTML
├── styles.css       # Estilos
├── script.js        # Lógica principal
├── photos/          # Fotos dos planetas (adicione aqui)
└── README.md
```

## Dados astronômicos

| Corpo         | Distância do Sol | Diâmetro     |
|---------------|-----------------|--------------|
| Sol           | 0               | 1.392.000 km |
| Mercúrio      | 57,9 M km       | 4.800 km     |
| Vênus         | 108,2 M km      | 12.100 km    |
| Terra         | 149,6 M km      | 12.700 km    |
| Marte         | 227,9 M km      | 6.800 km     |
| Júpiter       | 778,5 M km      | 140.000 km   |
| Saturno       | 1,43 B km       | 116.000 km   |
| Urano         | 2,87 B km       | 51.000 km    |
| Netuno        | 4,50 B km       | 49.000 km    |
| Plutão        | 5,91 B km       | 2.400 km     |

Luas incluídas: Lua (Terra), Fobos e Deimos (Marte), as 4 luas galileanas (Júpiter), 7 principais luas de Saturno incluindo Titã, 5 luas principais de Urano, Tritão (Netuno) e Caronte (Plutão).

## Funcionalidades planejadas

- [ ] Fotos reais dos planetas (NASA)
- [ ] Modo mobile com suporte a toque (swipe)
- [ ] Cronômetro no modo velocidade da luz
- [ ] Botão ativo com highlight do planeta atual no minimapa
- [ ] Marcador de Distância Lunar (DL)
- [ ] Ficha completa do planeta (número de luas, temperatura, etc.)

## Tecnologias

HTML5 · CSS3 · JavaScript vanilla (sem dependências)

## Licença

Projeto educacional de domínio público.
