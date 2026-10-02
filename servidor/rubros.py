"""Rubros del presupuesto. La fuente unica es rubros.js (la app y el servidor leen la misma lista)."""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
_FILA = re.compile(r"\['([a-z_]+)', '([a-z]+)', '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)', '([a-z]+)'\]")
_GRUPO = re.compile(r"\{ id: '([a-z]+)', es: '((?:[^'\\]|\\.)*)'")


def cargar():
    txt = (RAIZ / 'rubros.js').read_text(encoding='utf-8')
    grupos = {g: es for g, es in _GRUPO.findall(txt)}
    rubros = [{'id': i, 'g': g, 'es': es, 'en': en, 'cat': cat} for i, g, es, en, cat in _FILA.findall(txt)]
    assert rubros and grupos, 'no se pudo leer rubros.js'
    return grupos, rubros


GRUPOS, RUBROS = cargar()
IDS = [r['id'] for r in RUBROS]
CATEGORIA = {r['id']: r['cat'] for r in RUBROS}
INGRESOS = {r['id'] for r in RUBROS if r['g'] == 'ing'}
# La IA solo clasifica gastos y nunca el rubro de deudas (sale de la pestana Deudas).
IDS_GASTO = [r['id'] for r in RUBROS if r['g'] not in ('ing', 'deu')]


def para_prompt():
    """Lista agrupada 'id = nombre' para el modelo."""
    out = []
    for g, nombre in GRUPOS.items():
        if g in ('ing', 'deu'):
            continue
        out.append(f'{nombre}: ' + '; '.join(f"{r['id']} = {r['es']}" for r in RUBROS if r['g'] == g))
    return '\n'.join(out)
