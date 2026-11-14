"""Ejecuta el cuaderno y conserva las salidas reales en el archivo entregado.

Uso desde la raíz: python Pruebas_COG_LOLA/validar_notebook.py
No activa los barridos remotos extensos que la configuración deja desactivados.
"""
from pathlib import Path
import json
import nbformat
from nbclient import NotebookClient

root = Path(__file__).resolve().parent.parent
path = root / 'Pruebas_COG_LOLA.ipynb'
notebook = nbformat.read(path, as_version=4)
nbformat.validate(notebook)
for index, cell in enumerate(notebook.cells):
    if cell.cell_type == 'code':
        compile(cell.source, f'cell_{index}', 'exec')

def on_cell_complete(cell, cell_index, **kwargs):
    print(f'Celda {cell_index + 1}/{len(notebook.cells)} ejecutada', flush=True)

client = NotebookClient(notebook, timeout=600, kernel_name='python3',
                        resources={'metadata': {'path': str(root)}},
                        on_cell_complete=on_cell_complete)
try:
    client.execute()
finally:
    nbformat.write(notebook, path)
errors = [dict(cell=i, ename=out.get('ename'), evalue=out.get('evalue'))
          for i, cell in enumerate(notebook.cells) if cell.cell_type == 'code'
          for out in cell.get('outputs', []) if out.output_type == 'error']
result = dict(notebook=path.name, cells=len(notebook.cells),
              executed_code_cells=sum(c.cell_type == 'code' and c.execution_count is not None
                                      for c in notebook.cells), errors=errors)
(root / 'Pruebas_COG_LOLA' / 'validacion.json').write_text(
    json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=True, indent=2))
if errors:
    raise SystemExit(1)
