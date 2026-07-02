# -*- coding: utf-8 -*-
# ГЕНЕРАТОР ЗАДАЧ: придумывает случайные задачи на Грам-Шмидт (к уроку 11)
#
# Как пользоваться:
#   1. Запусти файл - он напечатает задачу.
#   2. Реши её на бумаге.
#   3. Нажми Enter - генератор покажет ответ и пошаговое решение.
#
# Настройки внизу файла: размер, диапазон чисел, ловушка с зависимостью.

import numpy as np
import numpy.linalg as la

verySmallNumber = 1e-14


def gsBasis(A):
    """Тот же Грам-Шмидт из урока 09 - им генератор считает ответ."""
    B = np.array(A, dtype=np.float64)
    for j in range(B.shape[1]):
        for i in range(j):
            B[:, j] = B[:, j] - B[:, j] @ B[:, i] * B[:, i]
        if la.norm(B[:, j]) > verySmallNumber:
            B[:, j] = B[:, j] / la.norm(B[:, j])
        else:
            B[:, j] = np.zeros_like(B[:, j])
    return B


def sdelat_zadachu(razmer, ot, do, s_lovushkoy):
    """Придумывает матрицу с векторами-столбцами.

    razmer      - сколько измерений и сколько векторов (2 или 3 удобно для бумаги)
    ot, do      - диапазон случайных целых чисел
    s_lovushkoy - если True, один вектор сделаем ЗАВИСИМЫМ (суммой других)
    """
    while True:
        # случайная матрица из целых чисел (endpoint: 'do' включительно)
        A = np.random.randint(ot, do + 1, size=(razmer, razmer)).astype(np.float64)

        # первый столбец не должен быть нулевым - иначе задача сломана
        if la.norm(A[:, 0]) < verySmallNumber:
            continue

        if s_lovushkoy and razmer >= 2:
            # последний вектор = сумма всех предыдущих -> он зависимый!
            A[:, razmer - 1] = A[:, : razmer - 1].sum(axis=1)

        return A


def pokazat_reshenie(A):
    """Печатает решение шаг за шагом, как в уроке 07."""
    B = np.array(A, dtype=np.float64)
    for j in range(B.shape[1]):
        print("-" * 40)
        print("Вектор номер", j + 1, ":", A[:, j])
        for i in range(j):
            ten_dlina = B[:, j] @ B[:, i]
            print("  тень на e%d: (v · e%d) = %.4f, вычитаем %s"
                  % (i + 1, i + 1, ten_dlina, np.round(ten_dlina * B[:, i], 4)))
            B[:, j] = B[:, j] - ten_dlina * B[:, i]
            print("  осталось:", np.round(B[:, j], 4))
        dlina = la.norm(B[:, j])
        if dlina > verySmallNumber:
            print("  длина остатка: %.4f -> делим на неё" % dlina)
            B[:, j] = B[:, j] / dlina
            print("  e%d = %s" % (j + 1, np.round(B[:, j], 4)))
        else:
            B[:, j] = np.zeros_like(B[:, j])
            print("  остаток исчез! вектор ЗАВИСИМЫЙ -> e%d = нули" % (j + 1))
    return B


# ========================== НАСТРОЙКИ ==========================
RAZMER = 2          # 2 = плоскость (легко на бумаге), 3 = пространство
OT, DO = -3, 3      # числа в векторах будут из этого диапазона
S_LOVUSHKOY = False  # True = подсунуть зависимый вектор (урок 07, раздел 7)
# ===============================================================

A = sdelat_zadachu(RAZMER, OT, DO, S_LOVUSHKOY)

print("=" * 50)
print("ЗАДАЧА: сделай процесс Грама-Шмидта для векторов")
print("(векторы - это СТОЛБЦЫ матрицы, читай сверху вниз):")
print(A)
for j in range(RAZMER):
    print("  v%d = %s" % (j + 1, A[:, j]))
print("=" * 50)

input("Реши на бумаге, потом нажми Enter, чтобы увидеть решение... ")

print()
print("ПОШАГОВОЕ РЕШЕНИЕ:")
E = pokazat_reshenie(A)

print("=" * 50)
print("ИТОГОВЫЙ ОТВЕТ (по столбцам):")
print(np.round(E, 4))
print()
print("Проверка E.T @ E (единицы на диагонали, нули вокруг = верно;")
print("ноль на диагонали = был зависимый вектор):")
print(np.round(E.T @ E, 6))
