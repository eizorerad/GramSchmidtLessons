# -*- coding: utf-8 -*-
# ПОЛНОЕ РЕШЕНИЕ: Грам-Шмидт со всеми проверками (к урокам 08-10)
#
# Этот файл можно запустить целиком и прочитать вывод сверху вниз -
# он сам рассказывает, что делает.

import numpy as np
import numpy.linalg as la

verySmallNumber = 1e-14        # порог "компьютерного нуля" (урок 08)


def gsBasis(A):
    """Процесс Грама-Шмидта для любого числа векторов-столбцов (урок 09)."""
    B = np.array(A, dtype=np.float64)            # копия + дробные числа

    for j in range(B.shape[1]):                  # для каждого столбца j...
        for i in range(j):                       # ...по всем предыдущим i:
            # вычитаем тень столбца j на (уже единичный) столбец i
            B[:, j] = B[:, j] - B[:, j] @ B[:, i] * B[:, i]

        if la.norm(B[:, j]) > verySmallNumber:   # осталось настоящее направление?
            B[:, j] = B[:, j] / la.norm(B[:, j])  # да: нормализуем
        else:
            B[:, j] = np.zeros_like(B[:, j])      # нет: зависимый, обнуляем

    return B


def dimensions(A):
    """Число независимых направлений в наборе векторов (урок 09)."""
    return np.sum(la.norm(gsBasis(A), axis=0))


def build_reflection_matrix(bearBasis):
    """Матрица отражения в наклонном зеркале (урок 10)."""
    E = gsBasis(bearBasis)      # выпрямили базис
    TE = np.array([[1, 0],      # простое отражение в системе зеркала
                   [0, -1]])
    return E @ TE @ E.T         # перевод -> отражение -> перевод обратно


# ============================ ДЕМОНСТРАЦИЯ ============================
print("=" * 60)
print("ТЕСТ 1: классический пример из уроков 07-08")
V = np.array([[1, 2, 3],
              [1, 0, 1],
              [1, 1, -1]], dtype=np.float64)
E = gsBasis(V)
print("исходные векторы (по столбцам):")
print(V)
print("после Грама-Шмидта:")
print(np.round(E, 3))
print("проверка E.T @ E (должна быть единичная матрица):")
print(np.round(E.T @ E, 10))

print("=" * 60)
print("ТЕСТ 2: зависимые векторы (v2 = 2*v1)")
V2 = np.array([[1, 2, 1],
               [0, 0, 1],
               [0, 0, 0]], dtype=np.float64)
print(np.round(gsBasis(V2), 3))
print("независимых направлений:", dimensions(V2))

print("=" * 60)
print("ТЕСТ 3: отражение в наклонном зеркале (урок 10)")
bearBasis = np.array([[1, -1],
                      [1.5, 2]], dtype=np.float64)
T = build_reflection_matrix(bearBasis)
r = np.array([1., 2.])
print("матрица отражения T:")
print(np.round(T, 3))
print("точка          :", r)
print("её отражение   :", np.round(T @ r, 3))
print("отразить дважды:", np.round(T @ (T @ r), 3), "<- вернулись в исходную!")
print("длина до/после :", la.norm(r), "/", round(la.norm(T @ r), 10))
